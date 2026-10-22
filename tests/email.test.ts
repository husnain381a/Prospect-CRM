import { afterEach, describe, it, expect, vi } from "vitest";
import {
  ResendAdapter,
  DeliveryUncertain,
  RetryableProviderError,
} from "../lib/adapters/email";
const input = {
  to: "hello@business.example",
  subject: "Exact subject",
  text: "Exact body\n\nUnsubscribe: https://app.example/unsubscribe?token=signed",
  unsubscribe: "https://app.example/unsubscribe?token=signed",
  idempotencyKey: "prospect-immutable-job",
};
afterEach(() => vi.unstubAllGlobals());
describe("real email transport adapter with mocked network", () => {
  it("uses a stable provider idempotency key and sends only the approved text", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM = "Sender <test@example.com>";
    const transport = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "provider-id" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", transport);
    expect(await new ResendAdapter().send(input)).toEqual({
      id: "provider-id",
    });
    const call = transport.mock.calls[0][1];
    expect(call.headers["Idempotency-Key"]).toBe(input.idempotencyKey);
    expect(JSON.parse(call.body).text).toBe(input.text);
    expect(JSON.parse(call.body).headers["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );
  });
  it("distinguishes retryable rate limits from ambiguous delivery outcomes", async () => {
    for (const status of [429, 500]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("{}", { status })),
      );
      await expect(new ResendAdapter().send(input)).rejects.toBeInstanceOf(
        status === 429 ? RetryableProviderError : DeliveryUncertain,
      );
    }
  });
  it("never treats a transport timeout as proof that no email was sent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    await expect(new ResendAdapter().send(input)).rejects.toBeInstanceOf(
      DeliveryUncertain,
    );
  });
});
