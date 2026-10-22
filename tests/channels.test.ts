import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  sendCall,
  sendWhatsApp,
  templateBody,
  templateFingerprint,
  verifyMeta,
  verifyTemplate,
  verifyTwilio,
  voiceXml,
} from "../lib/adapters/channels";
import { GooglePlacesDiscovery, googleReady } from "../lib/adapters/google";
import {
  DeliveryUncertain,
  RetryableProviderError,
} from "../lib/adapters/email";
import { eligibility } from "../lib/domain";
import { fixtureState } from "./fixtures/workspace";
import type { Recipient } from "../lib/types";
const t = {
  id: "123456",
  name: "business_offer",
  status: "APPROVED",
  language: "en_US",
  components: [{ type: "BODY", text: "Hello {{1}}. Reply STOP to opt out." }],
};
const r: Recipient = {
  lead_id: "lead",
  to: "+15125550101",
  subject: t.name,
  body: "Hello Comova. Reply STOP to opt out.",
  channel: "whatsapp",
  template: t.name,
  template_id: t.id,
  template_language: t.language,
  template_parameters: ["Comova"],
  template_fingerprint: templateFingerprint(t),
  scheduled_at: "2026-10-21T15:00:00Z",
  timezone: "America/Chicago",
  estimated_cost: 0.05,
};
function env() {
  vi.stubEnv("WHATSAPP_ENABLED", "true");
  vi.stubEnv("AUTOMATED_CALLS_ENABLED", "true");
  vi.stubEnv("APP_URL", "https://crm.example");
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-token");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123");
  vi.stubEnv("WHATSAPP_BUSINESS_ACCOUNT_ID", "456");
  vi.stubEnv("META_GRAPH_VERSION", "v99.0");
  vi.stubEnv("META_APP_SECRET", "test-secret");
  vi.stubEnv("META_VERIFY_TOKEN", "verify");
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC" + "a".repeat(32));
  vi.stubEnv("TWILIO_AUTH_TOKEN", "test-token");
  vi.stubEnv("TWILIO_FROM", "+15125550100");
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("official channel transports", () => {
  it("sends only the exact approved WhatsApp template payload and correlation ID", async () => {
    env();
    const f = vi
      .fn()
      .mockResolvedValue(Response.json({ messages: [{ id: "wamid.1" }] }));
    vi.stubGlobal("fetch", f);
    expect(await sendWhatsApp(r, "delivery-id")).toEqual({ id: "wamid.1" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v99.0/123/messages");
    const body = JSON.parse(init.body);
    expect(body.to).toBe("15125550101");
    expect(body.biz_opaque_callback_data).toBe("delivery-id");
    expect(body.template.components[0].parameters).toEqual([
      { type: "text", text: "Comova" },
    ]);
    expect(body.type).toBe("template");
    expect(body.text).toBeUndefined();
  });
  it("checks template changes, provider approval, format and missing values", async () => {
    env();
    expect(templateBody(t, ["Comova"])).toBe(r.body);
    expect(() =>
      templateBody({ ...t, status: "PAUSED" }, ["Comova"]),
    ).toThrow();
    expect(() => templateBody(t, [])).toThrow();
    expect(() =>
      templateBody(
        { ...t, components: [...t.components, { type: "BUTTONS" }] },
        ["Comova"],
      ),
    ).toThrow();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          ...t,
          components: [{ type: "BODY", text: "Changed {{1}}. STOP" }],
        }),
      ),
    );
    await expect(verifyTemplate(r)).rejects.toThrow("Template changed");
  });
  it("creates bounded voice calls with signed callback endpoints and no recording", async () => {
    env();
    const f = vi.fn().mockResolvedValue(Response.json({ sid: "CA123" }));
    vi.stubGlobal("fetch", f);
    expect(
      await sendCall(
        { ...r, channel: "call", call_max_seconds: 60 },
        "delivery-id",
      ),
    ).toEqual({ id: "CA123" });
    const body = f.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("Url")).toBe(
      "https://crm.example/api/voice?delivery=delivery-id",
    );
    expect(body.getAll("StatusCallbackEvent")).toEqual([
      "initiated",
      "ringing",
      "answered",
      "completed",
    ]);
    expect(body.get("TimeLimit")).toBe("60");
    expect(body.has("Record")).toBe(false);
    expect(
      voiceXml("Test <script> & message", "https://example.test/?a=1&b=2"),
    ).toContain("Test &lt;script&gt; &amp; message");
  });
  it("distinguishes explicit rate limits from uncertain acceptance and never blindly retries", async () => {
    env();
    for (const [status, error] of [
      [429, RetryableProviderError],
      [500, DeliveryUncertain],
    ] as const) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("", { status })),
      );
      await expect(sendWhatsApp(r, "delivery")).rejects.toBeInstanceOf(error);
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    await expect(sendCall(r, "delivery")).rejects.toBeInstanceOf(
      DeliveryUncertain,
    );
  });
});
describe("webhook authentication", () => {
  it("verifies Meta raw-body signatures and rejects tampering", () => {
    env();
    const raw = '{"object":"whatsapp_business_account"}';
    const signature =
      "sha256=" + createHmac("sha256", "test-secret").update(raw).digest("hex");
    expect(verifyMeta(raw, signature)).toBe(true);
    expect(verifyMeta(raw + " ", signature)).toBe(false);
    expect(verifyMeta(raw, "bad")).toBe(false);
  });
  it("matches a fixed HMAC signature fixture and rejects URL/account tampering", () => {
    vi.stubEnv("APP_URL", "https://mycompany.com");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "12345");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "CA1234567890ABCDE");
    const p = new URLSearchParams({
      CallSid: "CA1234567890ABCDE",
      Caller: "+14158675310",
      Digits: "1234",
      From: "+14158675310",
      To: "+18005551212",
    });
    // Fixed transport fixture, then account-bound validation.
    let data = "https://mycompany.com/myapp.php?foo=1&bar=2";
    for (const k of [...p.keys()].sort()) data += k + p.get(k);
    expect(createHmac("sha1", "12345").update(data).digest("base64")).toBe(
      "GvWf1cFY/Q7PnoempGyD5oXAezc=",
    );
    p.set("AccountSid", process.env.TWILIO_ACCOUNT_SID!);
    let canonical = "https://mycompany.com/myapp.php?foo=1&bar=2";
    for (const k of [...p.keys()].sort()) canonical += k + p.get(k);
    const signature = createHmac("sha1", "12345")
      .update(canonical)
      .digest("base64");
    const req = new Request("http://internal/myapp.php?foo=1&bar=2", {
      headers: { "x-twilio-signature": signature },
    });
    expect(verifyTwilio(req, p)).toBe(true);
    p.set("Digits", "9");
    expect(verifyTwilio(req, p)).toBe(false);
  });
});
describe("Google ingestion and eligibility", () => {
  it("blocks a missing API key before making a request", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "  ");
    expect(googleReady()).toBe(false);
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(
      new GooglePlacesDiscovery().discover({
        keyword: "dentist",
        locations: ["Lahore"],
        radius: 25,
        limit: 20,
        exclusions: [],
      }),
    ).rejects.toThrow("Google Places API key");
    expect(f).not.toHaveBeenCalled();
  });
  it("collects with only an API key and paginates without fabricating contacts or consent", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "key");
    vi.stubEnv("GOOGLE_PLACES_CRM_LICENSE_REFERENCE", "");
    expect(googleReady()).toBe(true);
    const f = vi.fn().mockImplementation(() =>
      Promise.resolve(
        Response.json({
          places: [
            {
              id: "g1",
              displayName: { text: "Business" },
              formattedAddress: "Lahore",
              internationalPhoneNumber: "+923001234567",
              timeZone: { id: "Asia/Karachi" },
              addressComponents: [{ types: ["country"], shortText: "PK" }],
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", f);
    const adapter = new GooglePlacesDiscovery();
    const q = {
      keyword: "dentist",
      locations: ["Lahore", "Karachi"],
      radius: 25,
      limit: 20,
      exclusions: [],
    };
    const result = await adapter.discover(q);
    expect(result.records[0].email).toBe("");
    expect(result.records[0].whatsapp).toBe("");
    expect(result.records[0].email_permission).toBe("unresolved");
    expect(result.records[0].timezone).toBe("Asia/Karachi");
    expect(result.nextCursor).toBeTruthy();
    await adapter.discover({ ...q, cursor: result.nextCursor });
    expect(JSON.parse(f.mock.calls[1][1].body).textQuery).toBe(
      "dentist in Karachi",
    );
  });
  it("requires verified phone and explicit automated calling consent", () => {
    const lead = {
      ...fixtureState().leads[0],
      phone: r.to,
      jurisdiction_approved: true,
      call_permission: "granted" as const,
      facts: {
        phone: {
          status: "verified" as const,
          source: "https://consent.example",
          retrievedAt: "now",
        },
      },
    };
    expect(
      eligibility(
        lead,
        { ...r, channel: "call" },
        new Date("2026-10-21T15:00:00Z"),
      ),
    ).toEqual([]);
    expect(
      eligibility(
        { ...lead, call_permission: "unresolved" },
        { ...r, channel: "call" },
        new Date("2026-10-21T15:00:00Z"),
      ),
    ).toContain(
      "Verified phone and explicit automated calling consent required",
    );
  });
});
