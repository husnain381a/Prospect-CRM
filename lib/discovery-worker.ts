import type { database } from "./database";
import type { DiscoveryAdapter } from "./adapters/discovery";
import {
  discoverySettingsSchema,
  matchesDiscovery,
  orderDiscoveryCandidates,
  reviewBand,
} from "./discovery-settings";
import { duplicate } from "./domain";

type Job = { id: string; workspace_id: string; checkpoint: any };
/** Collect a bounded pool before selection so the first page cannot consume the limit. */
export async function runConfiguredDiscovery(
  db: ReturnType<typeof database>,
  job: Job,
  workerId: string,
  adapter: DiscoveryAdapter,
  config: any,
) {
  const s = discoverySettingsSchema.parse(config.search_settings);
  let cursor = job.checkpoint.cursor || undefined;
  let pool: any[] = job.checkpoint.candidates || [];
  let calls = job.checkpoint.api_requests || 0;
  let scanned = job.checkpoint.scanned_count || 0;
  let cost = job.checkpoint.cost || 0;
  let exhausted = job.checkpoint.budget_exhausted || false;
  let scanComplete =
    job.checkpoint.scan_complete === true || job.checkpoint.done === true;
  let coverage = job.checkpoint.coverage || "";
  const started =
    await db`update discoveries set status='Running',progress=${calls ? Math.min(90, Math.round((calls / s.max_requests) * 90)) : 0} where id=${config.id} and workspace_id=${job.workspace_id} and status<>'Cancelled' returning id`;
  if (!started.length) {
    await db`update jobs set status='cancelled',locked_at=null,locked_by=null where id=${job.id} and locked_by=${workerId}`;
    return;
  }
  for (let step = 0; !scanComplete && step < 100; step++) {
    const [control] =
      await db`select status from discoveries where id=${config.id} and workspace_id=${job.workspace_id}`;
    if (!control || control.status === "Cancelled") {
      await db`update jobs set status='cancelled',locked_at=null,locked_by=null where id=${job.id} and locked_by=${workerId}`;
      return;
    }
    const result = await adapter.discover({
      ...config,
      search_settings: s,
      cursor,
      limit: 20,
    });
    calls += result.requestsUsed ?? 1;
    scanned += result.records.length;
    cost += result.cost;
    coverage = result.coverage;
    exhausted =
      result.budgetExhausted ??
      (calls >= s.max_requests && !!result.nextCursor);
    for (const lead of result.records)
      if (
        matchesDiscovery(lead, s, config.exclusions || []) &&
        !pool.some((p) => duplicate(p, lead as any))
      )
        pool.push(lead);
    cursor = result.nextCursor;
    scanComplete = !cursor || calls >= s.max_requests;
    const continued = await db.begin(async (tx) => {
      const [current] =
        await tx`select status from discoveries where id=${config.id} and workspace_id=${job.workspace_id} for update`;
      if (!current || current.status === "Cancelled") {
        await tx`update jobs set status='cancelled',locked_at=null,locked_by=null where id=${job.id} and locked_by=${workerId}`;
        return false;
      }
      const updated =
        await tx`update jobs set checkpoint=${tx.json({ cursor: cursor || null, candidates: pool, api_requests: calls, scanned_count: scanned, cost, coverage, budget_exhausted: exhausted, scan_complete: scanComplete })},locked_at=now() where id=${job.id} and locked_by=${workerId} and status='running' returning id`;
      if (!updated.length) return false;
      await tx`update discoveries set progress=${Math.min(90, Math.round((calls / s.max_requests) * 90))},data=data||${tx.json({ api_requests: calls, scanned_count: scanned, matched_count: pool.length, actual_cost: cost, coverage })} where id=${config.id}`;
      return true;
    });
    if (!continued) return;
  }
  if (!scanComplete) throw Error("Discovery request bound reached");
  await db.begin(async (tx) => {
    const [current] =
      await tx`select status from discoveries where id=${config.id} and workspace_id=${job.workspace_id} for update`;
    if (!current || current.status === "Cancelled") {
      await tx`update jobs set status='cancelled',locked_at=null,locked_by=null where id=${job.id} and locked_by=${workerId}`;
      return;
    }
    const [owned] =
      await tx`select id from jobs where id=${job.id} and locked_by=${workerId} and status='running' for update`;
    if (!owned) return;
    await tx`select pg_advisory_xact_lock(hashtext(${job.workspace_id}))`;
    const existing =
      await tx`select id,data from leads where workspace_id=${job.workspace_id}`;
    let saved = Number(job.checkpoint.count) || 0;
    const mix = [0, 0, 0];
    if (!job.checkpoint.done)
      for (const lead of orderDiscoveryCandidates(
        pool.filter(
          (lead) => !existing.some((row) => duplicate(row.data, lead)),
        ),
        s,
      )) {
        if (saved >= config.limit) break;
        if (existing.some((row) => duplicate(row.data, lead as any))) continue;
        const [inserted] =
          await tx`insert into leads(workspace_id,data) values(${job.workspace_id},${tx.json(lead)}) on conflict do nothing returning id`;
        if (!inserted) continue;
        saved++;
        mix[reviewBand(lead, s)]++;
        existing.push({ id: inserted.id, data: lead });
        if (config.auto_enrich === true && lead.website)
          await tx`insert into jobs(workspace_id,kind,payload,unique_key) values(${job.workspace_id},'enrichment',${tx.json({ lead_id: inserted.id, crawl_permission: true })},${"auto-enrich:" + inserted.id}) on conflict do nothing`;
      }
    const metrics = {
      saved_count: saved,
      scanned_count: scanned,
      matched_count: pool.length,
      api_requests: calls,
      actual_cost: cost,
      coverage,
      budget_exhausted: exhausted,
      review_mix: { low: mix[0], medium: mix[1], high: mix[2] },
    };
    await tx`update discoveries set status='Completed',progress=100,data=data||${tx.json(metrics)} where id=${config.id}`;
    await tx`insert into audit_log(workspace_id,event,entity_id,details) values(${job.workspace_id},'discovery.completed',${config.id},${tx.json(metrics)})`;
    if (config.schedule === "daily" || config.schedule === "weekly") {
      const delay = config.schedule === "daily" ? "1 day" : "7 days";
      await tx`insert into jobs(workspace_id,kind,payload,unique_key,run_at) values(${job.workspace_id},'discovery',${tx.json({ discovery_id: config.id })},${"scheduled:" + config.id + ":" + job.id},now()+${delay}::interval) on conflict do nothing`;
    }
    await tx`update jobs set status='completed',checkpoint=${tx.json({ count: saved, cost, api_requests: calls, done: true })},locked_at=null,locked_by=null where id=${job.id} and locked_by=${workerId}`;
  });
}
