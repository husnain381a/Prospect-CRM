export class DeliveryUncertain extends Error {}
export class RetryableProviderError extends Error {}
export interface EmailAdapter {
  send(input: {
    to: string;
    subject: string;
    text: string;
    unsubscribe: string;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
}
export class ResendAdapter implements EmailAdapter {
  async send(input: {
    to: string;
    subject: string;
    text: string;
    unsubscribe: string;
    idempotencyKey: string;
  }) {
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM)
      throw Error("Setup required: Resend key and verified sender");
    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM,
          to: [input.to],
          subject: input.subject,
          text: input.text,
          headers: {
            "List-Unsubscribe": `<${input.unsubscribe}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new DeliveryUncertain(
        "Transport interrupted; reconcile provider outcome before retry",
      );
    }
    if (response.status === 429)
      throw new RetryableProviderError("Provider rate limit");
    if (response.status >= 500)
      throw new DeliveryUncertain("Provider outcome uncertain");
    if (!response.ok)
      throw Error(`Email rejected by provider: ${response.status}`);
    const data = await response.json();
    if (!data.id)
      throw new DeliveryUncertain("Provider response missing delivery ID");
    return { id: String(data.id) };
  }
}
