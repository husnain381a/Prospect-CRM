import { Webhook } from "svix";
import { database } from "@/lib/database";
import { shouldStop } from "@/lib/domain";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret)
    return Response.json({ error: "Webhook setup required" }, { status: 503 });
  const payload = await request.text();
  if (payload.length > 1_000_000) return new Response(null, { status: 413 });
  let event: any;
  try {
    event = new Webhook(secret).verify(payload, {
      "svix-id": request.headers.get("svix-id") || "",
      "svix-timestamp": request.headers.get("svix-timestamp") || "",
      "svix-signature": request.headers.get("svix-signature") || "",
    });
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }
  try {
    const db = database();
    await db.begin(async (tx) => {
      const id = request.headers.get("svix-id")!;
      const inserted =
        await tx`insert into webhook_events(id,provider,event_type) values(${id},'resend',${String(event.type)}) on conflict do nothing returning id`;
      if (!inserted.length) return;
      const providerId = event.data?.email_id;
      let deliveries = providerId
        ? await tx`select * from deliveries where provider_id=${providerId} and channel='email'`
        : [];
      // Inbound mail can suppress only an exact sender match, never an inferred owner.
      if (event.type === "email.received") {
        const raw = String(event.data?.from || "");
        const address = (raw.match(/<([^>]+)>/)?.[1] || raw)
          .trim()
          .toLowerCase();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
          deliveries =
            await tx`select distinct on(workspace_id,lead_id) * from deliveries where recipient=${address} and channel='email' order by workspace_id,lead_id,created_at desc`;
      }
      for (const delivery of deliveries) {
        await tx`select id from workspaces where id=${delivery.workspace_id} for update`;
        const at = event.created_at ? new Date(event.created_at) : new Date();
        if (Number.isNaN(at.getTime())) throw Error("Invalid event timestamp");
        if (shouldStop(event.type)) {
          await tx`insert into suppressions(workspace_id,address,reason) values(${delivery.workspace_id},${delivery.recipient},${event.type}) on conflict(workspace_id,address) do nothing`;
          await tx`update leads set data=data||${tx.json({ stopped: true, ...(event.type === "email.received" ? { stage: "Replied" } : {}) })} where id=${delivery.lead_id} and workspace_id=${delivery.workspace_id}`;
          await tx`update jobs set status='cancelled',last_error=${event.type} where workspace_id=${delivery.workspace_id} and payload->>'lead_id'=${delivery.lead_id} and kind in ('email','followup','whatsapp','call') and status='queued'`;
          if (event.type === "email.received")
            await tx`update campaigns set replies=replies+1 where id=${delivery.campaign_id} and workspace_id=${delivery.workspace_id}`;
        }
        const status =
          event.type === "email.delivered"
            ? "delivered"
            : event.type === "email.bounced"
              ? "bounced"
              : event.type === "email.complained"
                ? "complained"
                : event.type === "email.received"
                  ? "replied"
                  : null;
        if (status)
          await tx`update deliveries set status=${status},last_event_at=${at} where id=${delivery.id} and (last_event_at is null or last_event_at<=${at})`;
        await tx`insert into audit_log(workspace_id,event,entity_id,details) values(${delivery.workspace_id},${String(event.type)},${delivery.id},${tx.json({ provider_event_id: id })})`;
      }
      await tx`update webhook_events set processed_at=now() where id=${id}`;
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "Event processing unavailable; retry required" },
      { status: 503 },
    );
  }
}
