import {
  channelEnabled,
  verifyTwilio,
  voiceXml,
} from "@/lib/adapters/channels";
import { database } from "@/lib/database";
import { stopLead } from "@/lib/channel-events";
import { eligibility } from "@/lib/domain";
import type { Lead, Recipient } from "@/lib/types";
export const runtime = "nodejs";
const hangup =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 100000) return new Response(null, { status: 413 });
  const p = new URLSearchParams(raw);
  if (!verifyTwilio(request, p))
    return new Response("Invalid signature", { status: 403 });
  const id = new URL(request.url).searchParams.get("delivery") || "";
  try {
    const db = database();
    const body = await db.begin(async (tx) => {
      const [d] =
        await tx`select * from deliveries where id::text=${id} and channel='call' and recipient=${p.get("To") || ""} and (provider_id is null or provider_id=${p.get("CallSid") || ""})`;
      if (!d) return hangup;
      await tx`select id from workspaces where id=${d.workspace_id} for update`;
      if (p.get("Digits") === "9") {
        const inserted =
          await tx`insert into webhook_events(id,provider,event_type,processed_at) values(${"twilio:optout:" + p.get("CallSid")},'twilio','opt_out',now()) on conflict do nothing returning id`;
        if (inserted.length) await stopLead(tx, d, "call.opt_out");
        await tx`update deliveries set status='opt_out' where id=${d.id}`;
        return hangup;
      }
      const [c] =
        await tx`select c.*,w.emergency_stop,campaign_hash(c.recipients,c.version) as current_hash from campaigns c join workspaces w on w.id=c.workspace_id where c.id=${d.campaign_id} and c.workspace_id=${d.workspace_id} for update of c`;
      const [l] =
        await tx`select * from leads where workspace_id=${d.workspace_id} and id=${d.lead_id} for update`;
      const [s] =
        await tx`select address from suppressions where workspace_id=${d.workspace_id} and address=${d.recipient}`;
      const [job] =
        await tx`select payload from jobs where workspace_id=${d.workspace_id} and 'prospect-'||id=${d.idempotency_key}`;
      const r = job?.payload.recipient as Recipient | undefined;
      if (
        !channelEnabled("call") ||
        !r ||
        !l ||
        !c ||
        c.emergency_stop ||
        c.status !== "Running" ||
        c.version !== d.version ||
        c.approved_hash !== c.current_hash ||
        c.call_approval_hash !== c.current_hash ||
        eligibility({ ...l.data, id: l.id } as Lead, r, new Date(), !!s).length
      )
        return hangup;
      if (d.voice_started) return hangup;
      await tx`update deliveries set voice_started=true,provider_id=coalesce(provider_id,${p.get("CallSid") || null}) where id=${d.id}`;
      return voiceXml(
        r.body,
        new URL("/api/voice?delivery=" + id, process.env.APP_URL!).toString(),
      );
    });
    return new Response(body, {
      headers: {
        "Content-Type": "application/xml",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("Retry voice processing", { status: 503 });
  }
}
