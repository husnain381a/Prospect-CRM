import { database } from "./database";
export async function stopLead(
  tx: any,
  d: any,
  reason: string,
  replied = false,
) {
  await tx`insert into suppressions(workspace_id,address,reason) values(${d.workspace_id},${d.recipient},${reason}) on conflict do nothing`;
  await tx`update leads set data=data||${tx.json({ stopped: true, ...(replied ? { stage: "Replied" } : {}) })} where workspace_id=${d.workspace_id} and id=${d.lead_id}`;
  await tx`update jobs set status='cancelled',last_error=${reason} where workspace_id=${d.workspace_id} and payload->>'lead_id'=${d.lead_id} and kind in ('email','followup','whatsapp','call') and status='queued'`;
  if (replied)
    await tx`update campaigns set replies=replies+1 where workspace_id=${d.workspace_id} and id=${d.campaign_id}`;
}
export async function channelEvent(input: {
  id: string;
  provider: string;
  channel: string;
  providerId?: string;
  deliveryId?: string;
  address?: string;
  status: string;
  at: Date;
  sequence?: number;
  stop?: boolean;
  replied?: boolean;
}) {
  if (!Number.isFinite(input.at.getTime()))
    throw Error("Invalid event timestamp");
  const db = database();
  await db.begin(async (tx) => {
    const inserted =
      await tx`insert into webhook_events(id,provider,event_type) values(${input.id},${input.provider},${input.status}) on conflict do nothing returning id`;
    if (!inserted.length) return;
    const rows = input.address
      ? await tx`select distinct on(workspace_id,lead_id) * from deliveries where channel=${input.channel} and recipient=${input.address} order by workspace_id,lead_id,created_at desc`
      : await tx`select * from deliveries where channel=${input.channel} and ((provider_id=${input.providerId || ""}) or (id::text=${input.deliveryId || ""} and (provider_id is null or provider_id=${input.providerId || ""})))`;
    for (const d of rows) {
      await tx`select id from workspaces where id=${d.workspace_id} for update`;
      if (input.stop) await stopLead(tx, d, input.status, !!input.replied);
      // A terminal state cannot regress when a provider reorders its callbacks.
      const terminal = [
        "failed",
        "undelivered",
        "busy",
        "no-answer",
        "canceled",
        "completed",
        "read",
        "replied",
        "opt_out",
      ];
      await tx`update deliveries set provider_id=coalesce(provider_id,${input.providerId || null}),status=${input.status},last_event_at=${input.at},callback_sequence=greatest(callback_sequence,${input.sequence ?? -1}) where id=${d.id} and (last_event_at is null or last_event_at<=${input.at}) and callback_sequence<=${input.sequence ?? 2147483647} and (status not in ${tx(terminal)} or ${terminal.includes(input.status)})`;
      if (input.providerId)
        await tx`update jobs set status='completed',locked_at=null,locked_by=null,last_error=null where workspace_id=${d.workspace_id} and 'prospect-'||id=${d.idempotency_key} and status='uncertain'`;
      await tx`insert into audit_log(workspace_id,event,entity_id,details) values(${d.workspace_id},${input.provider + "." + input.status},${d.id},${tx.json({ provider_event_id: input.id })})`;
    }
    await tx`update webhook_events set processed_at=now() where id=${input.id}`;
  });
}
