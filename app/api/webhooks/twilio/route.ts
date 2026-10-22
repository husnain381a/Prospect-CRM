import { verifyTwilio } from "@/lib/adapters/channels";
import { channelEvent } from "@/lib/channel-events";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 100000) return new Response(null, { status: 413 });
  const p = new URLSearchParams(raw);
  if (!verifyTwilio(request, p))
    return new Response("Invalid signature", { status: 403 });
  const status = p.get("CallStatus") || "";
  if (
    ![
      "queued",
      "initiated",
      "ringing",
      "in-progress",
      "completed",
      "busy",
      "failed",
      "no-answer",
      "canceled",
    ].includes(status)
  )
    return new Response(null, { status: 204 });
  const id = new URL(request.url).searchParams.get("delivery") || "";
  const sequence = Number(p.get("SequenceNumber"));
  if (!Number.isSafeInteger(sequence) || sequence < 0)
    return new Response("Invalid sequence", { status: 400 });
  try {
    await channelEvent({
      id: `twilio:${p.get("CallSid")}:${sequence}`,
      provider: "twilio",
      channel: "call",
      deliveryId: id,
      providerId: p.get("CallSid") || "",
      status,
      sequence,
      at: new Date(),
      stop: ["failed", "canceled"].includes(status),
    });
    return new Response(null, { status: 204 });
  } catch {
    return new Response("Retry event processing", { status: 503 });
  }
}
