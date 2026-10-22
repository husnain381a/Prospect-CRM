import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { canonical } from "../domain";
import { DeliveryUncertain, RetryableProviderError } from "./email";
import type { Recipient } from "../types";

export function configured(channel: string) {
  const names =
    channel === "whatsapp"
      ? [
          "WHATSAPP_ACCESS_TOKEN",
          "WHATSAPP_PHONE_NUMBER_ID",
          "WHATSAPP_BUSINESS_ACCOUNT_ID",
          "META_GRAPH_VERSION",
          "META_APP_SECRET",
          "META_VERIFY_TOKEN",
          "APP_URL",
        ]
      : channel === "call"
        ? ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "APP_URL"]
        : ["RESEND_API_KEY", "RESEND_FROM", "UNSUBSCRIBE_SECRET", "APP_URL"];
  return names.every((n) => !!process.env[n]);
}
export function channelEnabled(channel: string) {
  return (
    channel === "email" ||
    (channel === "whatsapp" && process.env.WHATSAPP_ENABLED === "true") ||
    (channel === "call" && process.env.AUTOMATED_CALLS_ENABLED === "true")
  );
}
export function requireChannel(channel: string) {
  if (!channelEnabled(channel))
    throw Error(`Setup required: ${channel} is paused for later activation`);
  if (!configured(channel))
    throw Error(`Setup required: ${channel} credentials and public APP_URL`);
  if (
    channel !== "email" &&
    new URL(process.env.APP_URL!).protocol !== "https:"
  )
    throw Error("Setup required: HTTPS APP_URL for verified webhooks");
}
function graphUrl(path: string) {
  const version = process.env.META_GRAPH_VERSION || "";
  if (!/^v\d+\.\d+$/.test(version))
    throw Error(
      "Setup required: META_GRAPH_VERSION (supported Graph API version)",
    );
  return `https://graph.facebook.com/${version}/${path}`;
}
export type MessageTemplate = {
  id: string;
  name: string;
  status: string;
  language: string;
  components: { type: string; text?: string; format?: string }[];
};
export function templateBody(t: MessageTemplate, parameters: string[]) {
  if (t.status !== "APPROVED")
    throw Error("WhatsApp template is not approved by Meta");
  // Only text BODY and static text FOOTER are supported. No hidden media, buttons, or headers.
  if (t.components.some((c) => !["BODY", "FOOTER"].includes(c.type)))
    throw Error("Use a text body template with optional static footer");
  const body = t.components.find((c) => c.type === "BODY")?.text;
  if (!body) throw Error("Template body missing");
  const indexes = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  if (
    parameters.length !== Math.max(0, ...indexes) ||
    parameters.some((v) => !v.trim() || /[\r\n\t]/.test(v))
  )
    throw Error("Supply one single-line value per template parameter");
  let rendered = body.replace(
    /\{\{(\d+)\}\}/g,
    (_, i) => parameters[Number(i) - 1],
  );
  if (/\{\{/.test(rendered))
    throw Error("Named or unresolved template parameters are unsupported");
  const footer = t.components.find((c) => c.type === "FOOTER")?.text;
  if (footer) rendered += "\n\n" + footer;
  if (!/\b(stop|unsubscribe|opt.out)\b/i.test(rendered))
    throw Error("Template must explain how to opt out");
  return rendered;
}
export function templateFingerprint(t: MessageTemplate) {
  return createHash("sha256")
    .update(
      canonical({
        id: t.id,
        name: t.name,
        language: t.language,
        components: t.components,
      }),
    )
    .digest("hex");
}
export async function getTemplate(id: string): Promise<MessageTemplate> {
  if (!/^\d{1,40}$/.test(id)) throw Error("Invalid template ID");
  const r = await fetch(
    graphUrl(id + "?fields=id,name,status,language,components"),
    {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    },
  );
  if (!r.ok) throw Error(`Template verification failed (${r.status})`);
  return r.json();
}
export async function listTemplates() {
  requireChannel("whatsapp");
  const id = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!;
  if (!/^\d+$/.test(id)) throw Error("Invalid WhatsApp business account ID");
  const all: MessageTemplate[] = [];
  let after = "";
  for (let i = 0; i < 10; i++) {
    const r = await fetch(
      graphUrl(
        id +
          "/message_templates?fields=id,name,status,language,components&limit=100" +
          (after ? "&after=" + encodeURIComponent(after) : ""),
      ),
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        },
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      },
    );
    if (!r.ok) throw Error(`Unable to load templates (${r.status})`);
    const data = await r.json();
    all.push(...(data.data || []));
    if (!data.paging?.next) return all.filter((t) => t.status === "APPROVED");
    after = data.paging?.cursors?.after;
    if (!after) throw Error("Template pagination cursor missing");
  }
  throw Error("Template pagination bound exceeded");
}
export async function verifyTemplate(r: Recipient) {
  const t = await getTemplate(r.template_id || "");
  if (
    t.name !== r.template ||
    t.language !== r.template_language ||
    templateFingerprint(t) !== r.template_fingerprint ||
    templateBody(t, r.template_parameters || []) !== r.body
  )
    throw Error("Template changed; edit and reapprove the campaign");
  return t;
}
async function accepted(url: string, init: RequestInit, idField: string) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new DeliveryUncertain(
      "Transport interrupted; reconcile provider before retry",
    );
  }
  if (response.status === 429)
    throw new RetryableProviderError("Provider rate limit");
  if (response.status >= 500)
    throw new DeliveryUncertain("Provider outcome uncertain");
  if (!response.ok)
    throw Error(`Provider rejected request (${response.status})`);
  const data = await response.json();
  const id = idField === "messages" ? data.messages?.[0]?.id : data[idField];
  if (!id) throw new DeliveryUncertain("Missing provider delivery ID");
  return { id: String(id) };
}
export async function sendWhatsApp(r: Recipient, deliveryId: string) {
  requireChannel("whatsapp");
  return accepted(
    graphUrl(process.env.WHATSAPP_PHONE_NUMBER_ID + "/messages"),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: r.to.replace(/^\+/, ""),
        type: "template",
        biz_opaque_callback_data: deliveryId,
        template: {
          name: r.template,
          language: { code: r.template_language },
          ...((r.template_parameters || []).length
            ? {
                components: [
                  {
                    type: "body",
                    parameters: r.template_parameters!.map((text) => ({
                      type: "text",
                      text,
                    })),
                  },
                ],
              }
            : {}),
        },
      }),
    },
    "messages",
  );
}
export async function sendCall(r: Recipient, deliveryId: string) {
  requireChannel("call");
  const callback = new URL(
    "/api/webhooks/twilio?delivery=" + deliveryId,
    process.env.APP_URL!,
  ).toString();
  const voice = new URL(
    "/api/voice?delivery=" + deliveryId,
    process.env.APP_URL!,
  ).toString();
  const body = new URLSearchParams({
    To: r.to,
    From: process.env.TWILIO_FROM!,
    Url: voice,
    Method: "POST",
    StatusCallback: callback,
    StatusCallbackMethod: "POST",
    TimeLimit: String(r.call_max_seconds || 60),
    Timeout: "25",
  });
  for (const event of ["initiated", "ringing", "answered", "completed"])
    body.append("StatusCallbackEvent", event);
  const account = process.env.TWILIO_ACCOUNT_SID!;
  if (!/^AC[0-9a-f]{32}$/i.test(account))
    throw Error("Invalid Twilio account SID");
  return accepted(
    `https://api.twilio.com/2010-04-01/Accounts/${account}/Calls.json`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(account + ":" + process.env.TWILIO_AUTH_TOKEN).toString(
            "base64",
          ),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
    "sid",
  );
}
export function equalSecret(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function verifyMeta(raw: string, signature: string) {
  return (
    !!process.env.META_APP_SECRET &&
    equalSecret(
      signature,
      "sha256=" +
        createHmac("sha256", process.env.META_APP_SECRET)
          .update(raw)
          .digest("hex"),
    )
  );
}
export function verifyTwilio(request: Request, params: URLSearchParams) {
  if (!process.env.TWILIO_AUTH_TOKEN || !process.env.APP_URL) return false;
  const u = new URL(request.url);
  let data = new URL(u.pathname + u.search, process.env.APP_URL).toString();
  for (const key of [...new Set(params.keys())].sort())
    for (const value of [...new Set(params.getAll(key))].sort())
      data += key + value;
  return (
    equalSecret(
      request.headers.get("x-twilio-signature") || "",
      createHmac("sha1", process.env.TWILIO_AUTH_TOKEN)
        .update(data)
        .digest("base64"),
    ) && params.get("AccountSid") === process.env.TWILIO_ACCOUNT_SID
  );
}
export function xml(value: string) {
  return value.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
}
export function voiceXml(body: string, action: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="dtmf" numDigits="1" timeout="5" method="POST" action="${xml(action)}"><Say voice="alice">${xml(body)}</Say></Gather><Hangup/></Response>`;
}
