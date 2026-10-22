import { describe, it, expect } from "vitest";
import {
  approvalHash,
  assertApproval,
  duplicate,
  eligibility,
  normalizeDomain,
  retryDelay,
  scores,
  shouldStop,
} from "../lib/domain";
import { fixtureState } from "./fixtures/workspace";
import { isPublicAddress } from "../lib/safe-fetch";
import { importRecord } from "../lib/import";
import { unsubscribeToken, verifyUnsubscribe } from "../lib/unsubscribe";
import { csvCell } from "../lib/utils";
import type { Recipient } from "../lib/types";
const lead = {
  ...fixtureState().leads[0],
  email: "hello@business.example",
  email_permission: "granted" as const,
  jurisdiction_approved: true,
  facts: {
    email: {
      status: "verified" as const,
      source: "https://business.example/contact",
      retrievedAt: new Date().toISOString(),
    },
  },
};
const r: Recipient = {
  lead_id: lead.id,
  to: lead.email,
  subject: "A real subject",
  body: "Exact message",
  scheduled_at: "2026-10-21T15:00:00Z",
  timezone: "America/Chicago",
  channel: "email",
  estimated_cost: 0.001,
};
describe("approval and safety", () => {
  it("binds every recipient field and the version", () => {
    const hash = approvalHash([r], 1);
    expect(() => assertApproval("Admin", [r], 1, hash)).not.toThrow();
    for (const change of [
      { to: "other@example.com" },
      { body: "changed" },
      { subject: "changed" },
      { scheduled_at: "2026-10-22T15:00:00Z" },
      { channel: "whatsapp" as const },
      { estimated_cost: 2 },
    ])
      expect(() =>
        assertApproval("Admin", [{ ...r, ...change }], 1, hash),
      ).toThrow();
    expect(() => assertApproval("Admin", [r], 2, hash)).toThrow();
  });
  it("does not let a manager or agent approve", () => {
    for (const role of ["Manager", "Agent"] as const)
      expect(() =>
        assertApproval(role, [r], 1, approvalHash([r], 1)),
      ).toThrow();
  });
  it("blocks unresolved, unverified, suppressed and stopped contacts", () => {
    const now = new Date("2026-10-21T15:00:00Z");
    expect(eligibility(lead, r, now)).toEqual([]);
    expect(
      eligibility({ ...lead, email_permission: "unresolved" }, r, now),
    ).toContain("Email permission unresolved");
    expect(
      eligibility({ ...lead, stopped: true }, r, now).length,
    ).toBeGreaterThan(0);
    expect(eligibility(lead, r, now, true).length).toBeGreaterThan(0);
    expect(eligibility({ ...lead, facts: {} }, r, now).length).toBeGreaterThan(
      0,
    );
  });
  it("uses recipient-local hours including weekends and bad timezones", () => {
    expect(eligibility(lead, r, new Date("2026-10-24T15:00:00Z"))).toContain(
      "Outside recipient-local business hours",
    );
    expect(eligibility(lead, r, new Date("2026-10-21T03:00:00Z"))).toContain(
      "Outside recipient-local business hours",
    );
    expect(eligibility(lead, { ...r, timezone: "fake" }, new Date())).toContain(
      "Valid recipient timezone required",
    );
  });
  it("never infers WhatsApp from a phone number", () => {
    expect(
      eligibility(lead, { ...r, channel: "whatsapp" }, new Date()).join(" "),
    ).toContain("Published WhatsApp");
  });
  it("stops followups on replies, complaints, bounces and opt-outs", () => {
    for (const type of [
      "email.received",
      "email.replied",
      "email.bounced",
      "email.complained",
      "opt_out",
      "manual_stop",
    ])
      expect(shouldStop(type)).toBe(true);
    expect(shouldStop("email.delivered")).toBe(false);
  });
});
describe("deduplication and importing", () => {
  it("normalizes domains but preserves branches sharing a domain or phone", () => {
    expect(normalizeDomain("https://www.Example.com/path")).toBe("example.com");
    expect(
      duplicate(
        { ...lead, source_id: "one", address: "1 Main St" },
        { ...lead, source_id: "two", address: "2 Main St" },
      ),
    ).toBe(false);
    expect(duplicate(lead, { ...lead, source_id: "same" })).toBe(true);
  });
  it("matches source IDs even when address formatting changes", () => {
    expect(duplicate(lead, { ...lead, address: "Other text" })).toBe(true);
  });
  it("keeps missing websites unverified and permissions unresolved", () => {
    const record = importRecord({
      name: "A real business",
      email: "team@example.com",
    });
    expect(record.website_status).toBe("unverified");
    expect(record.email_permission).toBe("unresolved");
    expect(record.export_allowed).toBe(false);
    expect(record.facts.email.status).toBe("unverified");
  });
  it("keeps scoring explainable and bounded", () => {
    const result = scores({
      ...lead,
      rating: 5,
      reviews: 10000,
      niche_fit: 100,
    });
    expect(result.reputation).toBe(100);
    expect(result.opportunity).toBeLessThanOrEqual(100);
  });
  it("neutralizes spreadsheet formula injection", () => {
    expect(csvCell('=HYPERLINK("evil")')).toMatch(/^"'/);
  });
});
describe("reliability and network boundaries", () => {
  it("uses bounded exponential retry backoff", () => {
    expect(retryDelay(2)).toBeGreaterThan(retryDelay(1));
    expect(retryDelay(99)).toBe(3600000);
  });
  it("blocks private, reserved, loopback and IPv4-mapped IPv6 hosts", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "192.168.1.1",
      "172.16.0.1",
      "::1",
      "fc00::1",
      "::ffff:127.0.0.1",
      "0.0.0.0",
      "224.0.0.1",
    ])
      expect(isPublicAddress(ip)).toBe(false);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
  });
  it("signs unsubscribe links and rejects tampering", () => {
    process.env.UNSUBSCRIBE_SECRET = "a".repeat(48);
    const token = unsubscribeToken("workspace", "Hello@Example.com");
    expect(verifyUnsubscribe(token)).toEqual({
      w: "workspace",
      a: "hello@example.com",
    });
    expect(() => verifyUnsubscribe(token + "x")).toThrow();
  });
});
