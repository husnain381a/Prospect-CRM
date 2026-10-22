import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { database } from "../lib/database";
import { eligibility, retryDelay, duplicate } from "../lib/domain";
import {
  DeliveryUncertain,
  ResendAdapter,
  RetryableProviderError,
} from "../lib/adapters/email";
import { GooglePlacesDiscovery } from "../lib/adapters/google";
import {
  channelEnabled,
  requireChannel,
  verifyTemplate,
  sendWhatsApp,
  sendCall,
} from "../lib/adapters/channels";
import { LicensedDiscovery } from "../lib/adapters/discovery";
import { safeFetch } from "../lib/safe-fetch";
import { unsubscribeToken } from "../lib/unsubscribe";
import type { Lead, Recipient } from "../lib/types";
const db = database();
const workerId = randomUUID();
let stopping = false;
let active = 0;
let polling = false;
const concurrency = Math.max(
  1,
  Math.min(8, Number(process.env.WORKER_CONCURRENCY) || 2),
);
const email = new ResendAdapter();
type Job = {
  id: string;
  workspace_id: string;
  kind: string;
  payload: any;
  attempts: number;
  checkpoint: any;
  unique_key: string;
};
async function defer(job: Job, minutes = 30) {
  await db`update jobs set status='queued',attempts=greatest(0,attempts-1),locked_at=null,locked_by=null,run_at=now()+${minutes + " minutes"}::interval where id=${job.id} and locked_by=${workerId}`;
}
async function complete(job: Job) {
  await db`update jobs set status='completed',locked_at=null,locked_by=null where id=${job.id} and locked_by=${workerId} and status='running'`;
}
async function processOutbound(job: Job) {
  const p = job.payload;
  const r = p.recipient as Recipient;
  const key = "prospect-" + job.id;
  if (!channelEnabled(r.channel)) return defer(job, 60);
  requireChannel(r.channel);
  if (r.channel === "whatsapp") await verifyTemplate(r);
  if (
    r.channel === "call" &&
    (!r.body.startsWith("This is an automated call from ") ||
      !r.body.endsWith("Press 9 to opt out of future outreach."))
  )
    throw Error("Approved call disclosure and opt-out missing");
  if (r.channel === "email") {
    const url = new URL(
      "/unsubscribe?token=" + unsubscribeToken(job.workspace_id, r.to),
      process.env.APP_URL!,
    ).toString();
    if (
      r.unsubscribe_url !== url ||
      !r.body.endsWith("\n\nUnsubscribe: " + url)
    )
      throw Error("Edit and reapprove the exact unsubscribe footer");
  }
  const reserved = await db.begin(async (tx) => {
    const [workspace] =
      await tx`select * from workspaces where id=${job.workspace_id} for update`;
    const [campaign] =
      await tx`select *,campaign_hash(recipients,version) as current_hash from campaigns where id=${p.campaign_id} and workspace_id=${job.workspace_id} for update`;
    if (
      !campaign ||
      workspace.emergency_stop ||
      campaign.version !== p.version ||
      !campaign.approved_hash ||
      campaign.approved_hash !== campaign.current_hash ||
      (r.channel === "call" &&
        campaign.call_approval_hash !== campaign.current_hash) ||
      ["Stopped", "Draft"].includes(campaign.status)
    ) {
      await tx`update jobs set status='cancelled' where id=${job.id}`;
      return false;
    }
    if (campaign.status === "Paused") {
      return "defer" as const;
    }
    const [row] =
      await tx`select * from leads where id=${p.lead_id} and workspace_id=${job.workspace_id} for update`;
    if (!row) throw Error("Recipient missing");
    const lead = { ...row.data, id: row.id } as Lead;
    if (
      r.channel === "call" &&
      lead.source === "Google Places" &&
      process.env.GOOGLE_PLACES_VOICE_LICENSE_ALLOWED !== "true"
    )
      throw Error(
        "Google-sourced data requires separate text-to-speech rights for calls",
      );
    const [suppression] =
      await tx`select address from suppressions where workspace_id=${job.workspace_id} and address=${r.to.toLowerCase()}`;
    const reasons = eligibility(lead, r, new Date(), !!suppression);
    if (reasons.some((x) => x !== "Outside recipient-local business hours")) {
      await tx`update jobs set status='cancelled',last_error=${reasons.join("; ")} where id=${job.id}`;
      return false;
    }
    if (reasons.length) return "defer" as const;
    const [rate] =
      await tx`select count(*) filter(where created_at>now()-interval '1 minute')::int as minute,count(*)::int as day from deliveries where workspace_id=${job.workspace_id} and created_at>now()-interval '1 day'`;
    if (rate.minute >= 30 || rate.day >= 200) return "defer" as const;
    const [existing] =
      await tx`select * from deliveries where idempotency_key=${key}`;
    if (existing) {
      if (existing.status === "sent" || existing.status === "delivered") {
        await tx`update jobs set status='completed' where id=${job.id}`;
        return false;
      }
      throw new DeliveryUncertain(
        "Existing reservation requires reconciliation",
      );
    }
    const [delivery] =
      await tx`insert into deliveries(workspace_id,campaign_id,lead_id,version,recipient,idempotency_key,channel) values(${job.workspace_id},${p.campaign_id},${p.lead_id},${p.version},${r.to.toLowerCase()},${key},${r.channel}) returning id`;
    return String(delivery.id);
  });
  if (reserved === "defer") return defer(job);
  if (!reserved) return;
  const unsubscribe = r.channel === "email" ? r.unsubscribe_url! : "";
  // Final gate locks workspace, campaign and lead through the bounded provider call.
  // Stop/permission changes serialize with this transaction; an already accepted send cannot be recalled.
  await db
    .begin(async (tx) => {
      const [workspace] =
        await tx`select * from workspaces where id=${job.workspace_id} for update`;
      const [campaign] =
        await tx`select *,campaign_hash(recipients,version) as current_hash from campaigns where id=${p.campaign_id} and workspace_id=${job.workspace_id} for update`;
      const [row] =
        await tx`select * from leads where id=${p.lead_id} and workspace_id=${job.workspace_id} for update`;
      const [s] =
        await tx`select address from suppressions where workspace_id=${job.workspace_id} and address=${r.to.toLowerCase()}`;
      const reasons = eligibility(
        { ...row.data, id: row.id } as Lead,
        r,
        new Date(),
        !!s,
      );
      if (
        workspace.emergency_stop ||
        campaign.status !== "Running" ||
        campaign.version !== p.version ||
        campaign.approved_hash !== campaign.current_hash ||
        (r.channel === "call" &&
          campaign.call_approval_hash !== campaign.current_hash) ||
        reasons.length
      ) {
        await tx`update deliveries set status='cancelled' where idempotency_key=${key}`;
        await tx`update jobs set status='cancelled',last_error='Eligibility or approval changed at final gate' where id=${job.id}`;
        return;
      }
      const result =
        r.channel === "whatsapp"
          ? await sendWhatsApp(r, reserved)
          : r.channel === "call"
            ? await sendCall(r, reserved)
            : await email.send({
                to: r.to,
                subject: r.subject,
                text: r.body,
                unsubscribe,
                idempotencyKey: key,
              });
      await tx`update deliveries set provider_id=${result.id},status='sent' where idempotency_key=${key}`;
      await tx`update campaigns set sent=sent+1 where id=${p.campaign_id}`;
      await tx`update leads set data=data||' {"stage":"Contacted"}'::jsonb where id=${p.lead_id}`;
      await tx`update jobs set status='completed' where id=${job.id}`;
      await tx`insert into audit_log(workspace_id,event,entity_id,details) values(${job.workspace_id},${r.channel + ".accepted"},${p.campaign_id},${tx.json({ job_id: job.id, provider_id: result.id, version: p.version })})`;
    })
    .catch(async (error) => {
      if (error instanceof RetryableProviderError) {
        await db`delete from deliveries where idempotency_key=${key} and status='reserved'`;
        throw error;
      }
      // Any exception after entering the provider transaction is conservatively uncertain.
      await db`update deliveries set status='uncertain' where idempotency_key=${key} and status='reserved'`;
      throw new DeliveryUncertain(error.message);
    });
}
async function processDiscovery(job: Job) {
  const id = job.payload.discovery_id;
  const [search] =
    await db`select * from discoveries where id=${id} and workspace_id=${job.workspace_id}`;
  if (!search || search.status === "Cancelled") {
    await db`update jobs set status='cancelled' where id=${job.id}`;
    return;
  }
  const config = search.data;
  if (config.provider === "osm") {
    await db`update discoveries set status='Cancelled' where id=${id} and workspace_id=${job.workspace_id}`;
    await db`update jobs set status='cancelled',locked_by=null,locked_at=null,last_error='Open-source discovery has been removed; create a new Google Places search' where id=${job.id}`;
    return;
  }
  const adapter =
    config.provider === "google"
      ? new GooglePlacesDiscovery()
      : config.provider === "licensed"
        ? new LicensedDiscovery()
        : null;
  if (!adapter)
    throw Error(
      "Unsupported discovery provider; create a new Google Places search",
    );
  let cursor = job.checkpoint.cursor as string | undefined;
  let count = Number(job.checkpoint.count) || 0;
  let cost = Number(job.checkpoint.cost) || 0;
  const finish = async () =>
    db.begin(async (tx) => {
      const [current] =
        await tx`select status from discoveries where id=${id} and workspace_id=${job.workspace_id} for update`;
      if (!current || current.status === "Cancelled") {
        await tx`update jobs set status='cancelled',locked_by=null,locked_at=null where id=${job.id}`;
        return;
      }
      await tx`update discoveries set status='Completed',progress=100 where id=${id}`;
      await tx`insert into audit_log(workspace_id,event,entity_id,details) values(${job.workspace_id},'discovery.completed',${id},${tx.json({ records: count, cost })})`;
      if (config.schedule === "daily" || config.schedule === "weekly") {
        const delay = config.schedule === "daily" ? "1 day" : "7 days";
        await tx`insert into jobs(workspace_id,kind,payload,unique_key,run_at) values(${job.workspace_id},'discovery',${tx.json({ discovery_id: id })},${"scheduled:" + id + ":" + job.id},now()+${delay}::interval) on conflict do nothing`;
      }
      await tx`update jobs set status='completed',locked_by=null,locked_at=null where id=${job.id} and locked_by=${workerId}`;
    });
  if (job.checkpoint.done) return finish();
  const started =
    await db`update discoveries set status='Running' where id=${id} and status<>'Cancelled' returning id`;
  if (!started.length) {
    await db`update jobs set status='cancelled' where id=${job.id}`;
    return;
  }
  for (let pages = 0; pages < 100; pages++) {
    const [control] = await db`select status from discoveries where id=${id}`;
    if (control.status === "Cancelled") {
      await db`update jobs set status='cancelled' where id=${job.id}`;
      return;
    }
    const result = await adapter.discover({
      ...config,
      cursor,
      limit: Math.min(100, config.limit - count),
    });
    const imported = await db.begin(async (tx) => {
      const [current] =
        await tx`select status from discoveries where id=${id} for update`;
      if (current.status === "Cancelled") {
        await tx`update jobs set status='cancelled' where id=${job.id}`;
        return false;
      }
      await tx`select pg_advisory_xact_lock(hashtext(${job.workspace_id}))`;
      const existing =
        await tx`select id,data from leads where workspace_id=${job.workspace_id}`;
      for (const lead of result.records) {
        if (count >= config.limit) break;
        const excluded = (config.exclusions || []).some((v: string) =>
          [lead.name, lead.website]
            .join(" ")
            .toLowerCase()
            .includes(v.toLowerCase()),
        );
        if (excluded) continue;
        count++;
        if (existing.some((row) => duplicate(row.data, lead as any))) continue;
        const [inserted] =
          await tx`insert into leads(workspace_id,data) values(${job.workspace_id},${tx.json(lead)}) on conflict do nothing returning id`;
        if (inserted) {
          existing.push({ id: inserted.id, data: lead });
          if (config.auto_enrich === true && lead.website)
            await tx`insert into jobs(workspace_id,kind,payload,unique_key) values(${job.workspace_id},'enrichment',${tx.json({ lead_id: inserted.id, crawl_permission: true })},${"auto-enrich:" + inserted.id}) on conflict do nothing`;
        }
      }
      cost += result.cost;
      cursor = result.nextCursor;
      await tx`update jobs set checkpoint=${tx.json({ cursor: cursor || null, count, cost, done: !cursor || count >= config.limit })},locked_at=now() where id=${job.id} and locked_by=${workerId}`;
      await tx`update discoveries set progress=${Math.min(99, Math.round((count / config.limit) * 100))},data=data||${tx.json({ actual_cost: cost, coverage: result.coverage })} where id=${id}`;
      return true;
    });
    if (!imported) return;
    if (!cursor || count >= config.limit) break;
    if (pages === 99) throw Error("Provider page bound reached");
  }
  await finish();
}

async function processEnrichment(job: Job) {
  if (job.payload.crawl_permission !== true)
    throw Error("Explicit website crawling permission required");
  const [row] =
    await db`select * from leads where id=${job.payload.lead_id} and workspace_id=${job.workspace_id}`;
  if (!row?.data.website) throw Error("Published website required");
  const started = Date.now();
  const result = await safeFetch(row.data.website);
  const facts = {
    ...row.data.facts,
    website_audit: {
      source: row.data.website,
      retrievedAt: new Date().toISOString(),
      status: "verified",
    },
  };
  // Only copy explicitly published contact links, never guessed addresses or phone capabilities.
  const publishedEmails = [
    ...result.html.matchAll(/href\s*=\s*["']mailto:([^"'?\s<>]+)/gi),
  ]
    .map((m) => m[1])
    .filter((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
  const phones = [
    ...result.html.matchAll(/href\s*=\s*["']tel:([^"'<>]+)/gi),
  ].map((m) => m[1].replace(/[^+0-9]/g, ""));
  const whatsapp = [
    ...result.html.matchAll(/href\s*=\s*["']https:\/\/wa\.me\/(\d{7,15})/gi),
  ].map((m) => "+" + m[1]);
  const contacts: Record<string, string> = {};
  if (!row.data.email && new Set(publishedEmails).size === 1)
    contacts.email = publishedEmails[0];
  if (!row.data.phone && new Set(phones).size === 1) contacts.phone = phones[0];
  if (!row.data.whatsapp && new Set(whatsapp).size === 1)
    contacts.whatsapp = whatsapp[0];
  for (const field of Object.keys(contacts))
    (facts as any)[field] = {
      source: row.data.website,
      retrievedAt: new Date().toISOString(),
      status: "published",
    };
  const audit = {
    accessible: result.status < 400,
    https: result.https,
    viewport_present: /name\s*=\s*["']viewport["']/i.test(result.html),
    response_ms: Date.now() - started,
    scope:
      "Basic HTML reachability audit only; not a Lighthouse or WCAG certification",
  };
  await db`update leads set data=data||${db.json({ ...contacts, facts, website_audit: audit })},updated_at=now() where id=${row.id}`;
  await complete(job);
}
async function run(job: Job) {
  try {
    if (job.kind === "discovery") await processDiscovery(job);
    else if (job.kind === "enrichment") await processEnrichment(job);
    else if (["email", "followup", "whatsapp", "call"].includes(job.kind))
      await processOutbound(job);
    else throw Error("Unsupported job kind");
  } catch (error) {
    const uncertain = error instanceof DeliveryUncertain;
    const message = error instanceof Error ? error.message : "Job failed";
    await db`update jobs set status=${uncertain ? "uncertain" : job.attempts >= 5 ? "dead" : "queued"},last_error=${message.slice(0, 500)},locked_at=null,locked_by=null,run_at=now()+${retryDelay(job.attempts) + " milliseconds"}::interval where id=${job.id} and locked_by=${workerId}`;
    if (job.kind === "discovery" && job.attempts >= 5)
      await db`update discoveries set status='Failed' where id=${job.payload.discovery_id}`;
    console.error(
      JSON.stringify({
        event: "job.failed",
        job: job.id,
        kind: job.kind,
        uncertain,
        attempt: job.attempts,
      }),
    );
  } finally {
    active--;
  }
}
async function tick() {
  if (stopping || polling) return;
  polling = true;
  try {
    await db`insert into worker_heartbeats(id) values(${workerId}) on conflict(id) do update set last_seen=now()`;
    // Reclaim only expired leases. Never blindly retry a possibly accepted email.
    await db`update jobs j set status=case when j.kind in ('email','followup','whatsapp','call') and exists(select 1 from deliveries d where d.idempotency_key='prospect-'||j.id) then 'uncertain' when attempts>=5 then 'dead' else 'queued' end,locked_by=null,locked_at=null,last_error='Worker lease expired' where status='running' and locked_at<now()-interval '5 minutes'`;
    while (active < concurrency && !stopping) {
      const [job] =
        await db`with next as(select id from jobs where status='queued' and run_at<=now() order by run_at for update skip locked limit 1) update jobs set status='running',attempts=attempts+1,locked_at=now(),locked_by=${workerId} where id in(select id from next) returning *`;
      if (!job) break;
      active++;
      void run(job as Job);
    }
  } finally {
    polling = false;
  }
}
const health = createServer(async (_req, res) => {
  try {
    await db`select 1`;
    res.writeHead(stopping ? 503 : 200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: stopping ? "stopping" : "ok",
        worker: workerId,
        active,
      }),
    );
  } catch {
    res.writeHead(503);
    res.end("Database unavailable");
  }
}).listen(Number(process.env.PORT) || 3001, "0.0.0.0");
const interval = setInterval(
  () =>
    void tick().catch(() =>
      console.error(JSON.stringify({ event: "worker.poll_failed" })),
    ),
  Math.max(1000, Number(process.env.WORKER_POLL_MS) || 2500),
);
void tick();
console.log(
  JSON.stringify({ event: "worker.started", id: workerId, concurrency }),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    stopping = true;
    clearInterval(interval);
    health.close();
    const timer = setTimeout(() => process.exit(1), 25000);
    while (active) await new Promise((r) => setTimeout(r, 200));
    await db.end();
    clearTimeout(timer);
    process.exit(0);
  });
