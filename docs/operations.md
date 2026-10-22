# Operations and recovery

## Observe

Monitor web 5xx/error rates, database pool exhaustion, webhook processing failures, dead jobs, uncertain sends, oldest due job, worker heartbeat freshness, provider 429s, daily cost and suppression growth. Application logs intentionally omit API keys and message bodies. Restrict access to the database, which contains contact data, approval content and audit records.

Useful read-only queries with an operator connection:

```sql
select status,kind,count(*) from public.jobs group by status,kind;
select min(run_at) from public.jobs where status='queued' and run_at<=now();
select id,last_seen from public.worker_heartbeats order by last_seen desc;
select id,kind,attempts,last_error from public.jobs where status in ('dead','uncertain');
select workspace_id,data->>'actual_cost' as actual_cost,data->>'coverage' as coverage from public.discoveries;
```

Configure an alert if no heartbeat is newer than 60 seconds, queue lag exceeds its target, a job reaches `dead`, or **any** delivery is `uncertain`. No monitoring vendor is preconfigured.

## Sending limits and stops

The initial worker limits a workspace to 30 reserved attempts/minute and 200/day. These are intentionally conservative constants in `worker/index.ts`; validate and configure your provider-specific quotas before increasing them. Weekday sending hours are 09:00–17:00 in each approved recipient's IANA timezone. Deferred jobs do not consume failure-attempt budget. A pause retains queued work and checks again later. Resume launches the same version using unique job keys.

The emergency-stop RPC is Admin-only and sets the workspace stop flag, invalidates approvals, stops campaigns and cancels queued email, follow-up, WhatsApp and call jobs. Permission updates, manual stop, campaign changes and webhook suppression serialize against the worker's final gate. A provider call already accepted before the stop returns cannot be undone. To clear the flag after review, an Admin may call `emergency_stop_workspace(w, false)`; stopped campaigns still require renewed approval. The UI never automatically clears an emergency stop.

## Worker crash / lease expiry

Jobs have a five-minute lease. Discovery checkpoints persist cursor, processed count, cost and completion state; the worker checkpoints each page. Expired discovery/enrichment leases are reclaimed. Expired send leases with a ledger reservation become `uncertain`. Error retries use exponential backoff starting at three seconds, capped at one hour, with at most five attempts. Dead jobs require operator review.

Do not blindly reset `uncertain` jobs to queued. A timeout, 5xx, missing provider ID, or database failure after an accepted API request may have sent the message. Use the stable ledger idempotency key and provider logs/support to establish the outcome. If accepted, record the provider ID/status, mark the job complete and append an operator reconciliation audit entry. If the outcome remains unknown, keep it held. If the provider proves it was never accepted, document that evidence before any administrative retry. Provider idempotency retention is finite; it is not a permanent exactly-once guarantee.

Source-less imports with unknown addresses intentionally avoid speculative deduplication. Review them manually. CSV payloads validate before insertion, but an infrastructure error mid-import can commit a prefix; retry with source IDs. Never delete different branches merely because a chain shares a domain or phone.

## Webhook retry and suppression

Svix signatures validate the original raw request body and timestamp. Webhook IDs are deduplicated in the same transaction as delivery/suppression processing. A transaction failure returns 503 so the provider can retry. Unsubscribe POSTs are signed, idempotent and independent of a user session. GET only shows confirmation, avoiding state changes from email link scanners. Inbound replies, bounces and complaints suppress subsequent sends; manual intervention is also checked immediately before each send.

The initial inbound implementation relies on verified provider events and exact sender-address matching. Review your inbound provider's anti-spoofing configuration. It does not parse arbitrary mailboxes or infer thread/owner identities.

## Backups and restoration

Enable the Supabase plan's backups/PITR and separately back up Storage objects and provider configuration. Proposed RPO: 15 minutes; proposed RTO: four hours. Confirm actual plan capabilities and rehearse restoration before committing to those targets.

Restore into a new staging project with **workers and outbound integrations disabled**. Restore schema, Auth/memberships, tenant data, queue, ledger, audit and Storage together. Preserve IDs and suppression history. Reconcile every running/uncertain delivery against the provider before enabling a worker. Validate RLS with two real users and repeat the signed event/opt-out tests. Cut over only after the operator confirms that already sent jobs cannot be replayed.

Retention/deletion workflows and legal-hold controls are not yet included. Establish a data-retention policy appropriate to your license and deployment before collecting a large dataset.

## Meta and Twilio operations

Meta webhook challenge/signature verification uses `META_VERIFY_TOKEN` and `META_APP_SECRET`. Only events matching the configured WhatsApp business account and sending phone-number ID are processed. Statuses use provider ID / opaque delivery correlation; inbound addresses match existing WhatsApp deliveries exactly. Any inbound response stops future outreach for that lead. Failed deliveries are conservatively suppressed.

Twilio callbacks and voice instructions validate `X-Twilio-Signature` against the canonical public `APP_URL`, all form fields, the configured account SID and the reserved delivery. Status sequence numbers reject reordered callbacks. The instruction route rechecks current approval, separate calling approval, consent, stops and local hours; it never accepts an arbitrary spoken script from a webhook. Pressing 9 stops all future outreach. Scripts are served once per reservation, with no call recording. Retry after an instruction response is lost can result in a hangup rather than replaying the script.

Meta/Twilio do not receive a promise of permanent request idempotency. Ambiguous API acceptance holds the job as uncertain; late correlated signed status callbacks can reconcile it. Operators must investigate any remaining uncertain jobs before attempting another send. Activity in Automation exposes recent state/errors; administrative retry/reconciliation remains an operator database workflow.
