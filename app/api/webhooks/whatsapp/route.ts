import { equalSecret, verifyMeta } from "@/lib/adapters/channels";
import { channelEvent } from "@/lib/channel-events";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  if (
    process.env.META_VERIFY_TOKEN &&
    p.get("hub.mode") === "subscribe" &&
    equalSecret(p.get("hub.verify_token") || "", process.env.META_VERIFY_TOKEN)
  )
    return new Response(p.get("hub.challenge"), {
      headers: { "Content-Type": "text/plain" },
    });
  return new Response("Invalid verification", { status: 403 });
}
export async function POST(request: Request) {
  if (!process.env.META_APP_SECRET)
    return new Response("Webhook setup required", { status: 503 });
  const raw = await request.text();
  if (raw.length > 1_000_000) return new Response(null, { status: 413 });
  if (!verifyMeta(raw, request.headers.get("x-hub-signature-256") || ""))
    return new Response("Invalid signature", { status: 403 });
  try {
    const event = JSON.parse(raw);
    if (event.object !== "whatsapp_business_account")
      return Response.json({ ok: true });
    for (const entry of event.entry || []) {
      if (String(entry.id) !== process.env.WHATSAPP_BUSINESS_ACCOUNT_ID)
        continue;
      for (const change of entry.changes || []) {
        const value = change.value;
        if (
          String(value?.metadata?.phone_number_id) !==
          process.env.WHATSAPP_PHONE_NUMBER_ID
        )
          continue;
        for (const s of value.statuses || []) {
          if (!["sent", "delivered", "read", "failed"].includes(s.status))
            continue;
          await channelEvent({
            id: `meta:${s.id}:${s.status}:${s.timestamp}`,
            provider: "meta",
            channel: "whatsapp",
            providerId: String(s.id),
            deliveryId: String(s.biz_opaque_callback_data || ""),
            status: s.status,
            at: new Date(Number(s.timestamp) * 1000),
            stop: s.status === "failed",
          });
        }
        for (const m of value.messages || []) {
          const address = "+" + String(m.from).replace(/\D/g, "");
          if (!/^\+[1-9]\d{6,14}$/.test(address)) continue;
          const optout =
            /^(stop|unsubscribe|cancel|quit|end|opt[ -]?out)$/i.test(
              (
                m.text?.body ||
                m.button?.text ||
                m.interactive?.button_reply?.title ||
                ""
              ).trim(),
            );
          await channelEvent({
            id: "meta:in:" + m.id,
            provider: "meta",
            channel: "whatsapp",
            address,
            status: optout ? "opt_out" : "replied",
            at: new Date(Number(m.timestamp) * 1000),
            stop: true,
            replied: !optout,
          });
        }
      }
    }
    return Response.json({ ok: true });
  } catch {
    return new Response("Retry event processing", { status: 503 });
  }
}
