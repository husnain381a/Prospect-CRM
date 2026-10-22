import { createHmac, timingSafeEqual } from "node:crypto";
export function unsubscribeToken(workspace: string, address: string) {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret || secret.length < 32)
    throw Error(
      "Setup required: UNSUBSCRIBE_SECRET must contain at least 32 characters",
    );
  const payload = Buffer.from(
    JSON.stringify({ w: workspace, a: address.toLowerCase() }),
  ).toString("base64url");
  return (
    payload +
    "." +
    createHmac("sha256", secret).update(payload).digest("base64url")
  );
}
export function verifyUnsubscribe(token: string) {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret) throw Error("Unsubscribe not configured");
  const [payload, sig] = token.split(".");
  if (!payload || !sig) throw Error("Invalid link");
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(sig, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw Error("Invalid link");
  const result = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (typeof result.w !== "string" || typeof result.a !== "string")
    throw Error("Invalid link");
  return result as { w: string; a: string };
}
