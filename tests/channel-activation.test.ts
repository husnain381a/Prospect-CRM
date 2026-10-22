import { afterEach, describe, it, expect, vi } from "vitest";
import { channelEnabled, requireChannel } from "../lib/adapters/channels";
afterEach(() => vi.unstubAllEnvs());
describe("email-only activation", () => {
  it("keeps advanced transports blocked even if credentials exist until explicitly enabled", () => {
    vi.stubEnv("WHATSAPP_ENABLED", "false");
    vi.stubEnv("AUTOMATED_CALLS_ENABLED", "false");
    expect(channelEnabled("email")).toBe(true);
    expect(channelEnabled("whatsapp")).toBe(false);
    expect(channelEnabled("call")).toBe(false);
    expect(() => requireChannel("whatsapp")).toThrow("paused");
    expect(() => requireChannel("call")).toThrow("paused");
    vi.stubEnv("WHATSAPP_ENABLED", "true");
    expect(channelEnabled("whatsapp")).toBe(true);
    expect(channelEnabled("call")).toBe(false);
  });
});
