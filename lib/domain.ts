import { createHash } from "node:crypto";
import type { Lead, Recipient, Role } from "./types";
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonical((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
export function approvalHash(recipients: Recipient[], version: number) {
  return createHash("sha256")
    .update(canonical({ recipients, version }))
    .digest("hex");
}
export function assertApproval(
  role: Role,
  recipients: Recipient[],
  version: number,
  approvedHash: string | undefined,
) {
  if (role !== "Admin") throw Error("Only an admin can approve outreach");
  if (!approvedHash || approvedHash !== approvalHash(recipients, version))
    throw Error("Approval does not match this exact version");
}
export function normalizeDomain(url: string) {
  try {
    return new URL(url.includes("://") ? url : "https://" + url).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}
export function normalizePhone(phone: string) {
  return phone.replace(/[^0-9]/g, "");
}
const text = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
export function duplicate(a: Partial<Lead>, b: Partial<Lead>) {
  if (
    a.source &&
    a.source === b.source &&
    a.source_id &&
    a.source_id === b.source_id
  )
    return true;
  // Shared chain domains or switchboards alone must not collapse distinct branches.
  const sameAddress =
    !!a.address &&
    !!b.address &&
    text(a.address) === text(b.address) &&
    text(a.country || "") === text(b.country || "");
  if (!sameAddress) return false;
  return (
    (!!a.website &&
      normalizeDomain(a.website) === normalizeDomain(b.website || "")) ||
    (!!a.phone && normalizePhone(a.phone) === normalizePhone(b.phone || "")) ||
    (!!a.name && text(a.name) === text(b.name || ""))
  );
}
export { scores } from "./scoring";
export function eligibility(
  lead: Lead,
  recipient: Recipient,
  now = new Date(),
  suppressed = false,
) {
  const reasons: string[] = [];
  if (suppressed || lead.stopped)
    reasons.push("Suppressed or manually stopped");
  if (!lead.jurisdiction_approved) reasons.push("Jurisdiction review required");
  if (!lead.timezone || recipient.timezone !== lead.timezone)
    reasons.push("Recipient timezone must match the reviewed lead timezone");
  if (recipient.channel === "email") {
    if (lead.email_permission !== "granted")
      reasons.push("Email permission unresolved");
    if (
      !lead.email ||
      recipient.to.toLowerCase() !== lead.email.toLowerCase() ||
      lead.facts.email?.status !== "verified"
    )
      reasons.push("Recipient email must be verified");
  }
  if (recipient.channel === "whatsapp") {
    if (
      !lead.whatsapp_opt_in ||
      !lead.whatsapp ||
      recipient.to !== lead.whatsapp ||
      !recipient.template ||
      lead.facts.whatsapp?.status !== "verified"
    )
      reasons.push("Published WhatsApp, opt-in and approved template required");
  }
  if (
    recipient.channel === "call" &&
    (lead.call_permission !== "granted" ||
      !lead.phone ||
      recipient.to !== lead.phone ||
      lead.facts.phone?.status !== "verified")
  )
    reasons.push(
      "Verified phone and explicit automated calling consent required",
    );
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: recipient.timezone,
      hour: "numeric",
      hourCycle: "h23",
      weekday: "short",
    });
    const parts = fmt.formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const day = parts.find((p) => p.type === "weekday")?.value;
    if (hour < 9 || hour >= 17 || day === "Sun" || day === "Sat")
      reasons.push("Outside recipient-local business hours");
  } catch {
    reasons.push("Valid recipient timezone required");
  }
  return reasons;
}
export function shouldStop(event: string) {
  return [
    "email.replied",
    "email.received",
    "email.bounced",
    "email.complained",
    "opt_out",
    "manual_stop",
  ].includes(event);
}
export function retryDelay(attempt: number) {
  return Math.min(3600000, 3000 * 2 ** Math.max(0, attempt - 1));
}
