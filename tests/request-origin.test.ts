import { afterEach, describe, expect, it, vi } from "vitest";
import { requestOriginAllowed } from "../lib/request-origin";

afterEach(() => vi.unstubAllEnvs());

describe("action request origin", () => {
  it("accepts the browser Host when Next uses an internal listen address", () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    const request = new Request("http://0.0.0.0:3000/api/actions", {
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
    });
    expect(requestOriginAllowed(request)).toBe(true);
  });

  it("rejects other sites and different ports even with matching-looking names", () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    for (const origin of [
      "https://evil.example",
      "http://127.0.0.1:4000",
      "http://localhost.evil.example:3000",
    ]) {
      const request = new Request("http://0.0.0.0:3000/api/actions", {
        headers: { host: "127.0.0.1:3000", origin },
      });
      expect(requestOriginAllowed(request)).toBe(false);
    }
  });

  it("normalizes the configured public app URL", () => {
    vi.stubEnv("APP_URL", "https://crm.example/");
    expect(
      requestOriginAllowed(
        new Request("http://internal:3000/api/actions", {
          headers: { host: "internal:3000", origin: "https://crm.example" },
        }),
      ),
    ).toBe(true);
  });

  it("supports HTTPS terminated by a proxy without trusting forwarded Host", () => {
    vi.stubEnv("APP_URL", "");
    const headers = {
      host: "crm.example",
      origin: "https://crm.example",
      "x-forwarded-proto": "https",
    };
    expect(
      requestOriginAllowed(
        new Request("http://0.0.0.0:3000/api/actions", { headers }),
      ),
    ).toBe(true);
    expect(
      requestOriginAllowed(
        new Request("http://0.0.0.0:3000/api/actions", {
          headers: {
            ...headers,
            origin: "https://evil.example",
            "x-forwarded-host": "evil.example",
          },
        }),
      ),
    ).toBe(false);
  });

  it("rejects null and malformed browser origins", () => {
    for (const origin of [
      "null",
      "garbage",
      "https://crm.example/path",
      "https://user@crm.example",
      "https://crm.example, https://evil.example",
    ]) {
      expect(
        requestOriginAllowed(
          new Request("https://crm.example/api/actions", {
            headers: { host: "crm.example", origin },
          }),
        ),
      ).toBe(false);
    }
  });

  it("allows authenticated non-browser clients to omit Origin", () => {
    expect(
      requestOriginAllowed(new Request("https://crm.example/api/actions")),
    ).toBe(true);
  });
});
