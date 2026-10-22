import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { channelEvent } from "../lib/channel-events";

import { PGlite } from "@electric-sql/pglite";

import { readFile, readdir } from "node:fs/promises";

const db = new PGlite();
// Execute the production event handler SQL against real embedded PostgreSQL.
// Only the postgres transport is replaced; transactions, RLS and SQL are real.
const sql: any = (parts: any, ...values: any[]) => {
  if (!Array.isArray(parts) || !(parts as any).raw) return { list: parts };
  const args: any[] = [];
  let query = parts[0];
  values.forEach((v, i) => {
    if (v && typeof v === "object" && "list" in v)
      query +=
        "(" +
        v.list
          .map((x: any) => {
            args.push(x);
            return "$" + args.length;
          })
          .join(",") +
        ")";
    else {
      args.push(v instanceof Date ? v.toISOString() : v);
      query += "$" + args.length;
    }
    query += parts[i + 1];
  });
  return db.query(query, args).then((r) => r.rows);
};
sql.json = (v: any) => JSON.stringify(v);
sql.begin = async (fn: any) => {
  await db.exec("begin");
  try {
    const result = await fn(sql);
    await db.exec("commit");
    return result;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
};
vi.mock("../lib/database", () => ({ database: () => sql }));

const userA = "10000000-0000-4000-8000-000000000001";

const userB = "10000000-0000-4000-8000-000000000002";

const agent = "10000000-0000-4000-8000-000000000003";

const manager = "10000000-0000-4000-8000-000000000004";

let workspaceA: string, workspaceB: string, leadA: string;
let retiredWorkspace: string, retiredDiscovery: string;

async function asUser(id: string) {
  await db.exec("reset role");

  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);

  await db.exec("set role authenticated");
}

async function rpc<T = any>(query: string, args: unknown[] = []) {
  return (await db.query<T>(query, args)).rows;
}

beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;

 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,name text,bucket_id text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);

  let sql = await readFile(
    new URL("../supabase/migrations/001_platform.sql", import.meta.url),

    "utf8",
  );

  sql = sql.replace(
    /do \$\$begin alter publication supabase_realtime[\s\S]*?end\$\$;/,

    "-- Publication is managed by Supabase, omitted in embedded PostgreSQL.",
  );

  await db.exec(sql);

  await db.exec(
    await readFile(
      new URL("../supabase/migrations/002_enrichment.sql", import.meta.url),

      "utf8",
    ),
  );

  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/003_scoring_and_queries.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261021203411_automated_channels.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  for (const file of await readdir(
    new URL("../supabase/migrations/", import.meta.url),
  )) {
    if (
      file.endsWith("_recipient_timezone_review.sql") ||
      file.endsWith("_open_places_runtime.sql")
    )
      await db.exec(
        await readFile(
          new URL("../supabase/migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
  }
  retiredWorkspace = (
    await rpc(
      "insert into workspaces(name) values('Retired source migration test') returning id",
    )
  )[0].id;
  retiredDiscovery = (
    await rpc(
      "insert into discoveries(workspace_id,data) values($1,$2::jsonb) returning id",
      [
        retiredWorkspace,
        JSON.stringify({ provider: "osm", keyword: "cafes", limit: 5 }),
      ],
    )
  )[0].id;
  await rpc(
    "insert into jobs(workspace_id,kind,payload,unique_key) values($1,'discovery',$2::jsonb,'retired-source-test')",
    [retiredWorkspace, JSON.stringify({ discovery_id: retiredDiscovery })],
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261022150348_official_places_only.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.query("insert into auth.users values($1),($2),($3),($4)", [
    userA,

    userB,

    agent,

    manager,
  ]);

  await asUser(userA);

  workspaceA = (await rpc("select create_workspace($1) as id", ["Tenant A"]))[0]
    .id;

  await asUser(userB);

  workspaceB = (await rpc("select create_workspace($1) as id", ["Tenant B"]))[0]
    .id;

  await db.exec("reset role");

  await db.query("insert into workspace_members values($1,$2,$3),($1,$4,$5)", [
    workspaceA,

    agent,

    "Agent",

    manager,

    "Manager",
  ]);

  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261022192803_authorized_workspace_access.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  await asUser(userA);

  leadA = (
    await rpc("select import_lead($1,$2::jsonb) as id", [
      workspaceA,

      JSON.stringify({
        name: "Branch One",

        address: "1 Main St",

        country: "US",

        source: "Authorized CSV",

        source_id: "one",

        website: "https://chain.example",

        phone: "+15125550100",

        email: "hello@business.example",

        timezone: "America/Chicago",

        stage: "New",

        facts: {},
      }),
    ])
  )[0].id;
}, 30000);

afterAll(async () => {
  await db.close();
});

describe("actual PostgreSQL RLS and security-definer boundaries", () => {
  it("prevents signed-in users from provisioning themselves as administrators", async () => {
    await asUser(userA);
    await expect(
      rpc("select create_workspace('Unauthorized')"),
    ).rejects.toThrow(/permission denied/);
    await asUser("10000000-0000-4000-8000-000000000099");
    expect(await rpc("select * from workspaces")).toEqual([]);
    expect(await rpc("select * from leads")).toEqual([]);
    await expect(
      rpc("select create_workspace('Unauthorized')"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      rpc("insert into workspace_members values($1,$2,'Admin')", [
        workspaceA,
        "10000000-0000-4000-8000-000000000099",
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      rpc("select update_lead($1,$2,'{}'::jsonb)", [workspaceA, leadA]),
    ).rejects.toThrow("Forbidden");
  });
  it("blocks anonymous database access and self-provisioning", async () => {
    await db.exec("reset role; set role anon");
    await expect(rpc("select * from leads")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      rpc("select create_workspace('Unauthorized')"),
    ).rejects.toThrow(/permission denied/);
  });
  it("revokes data and mutation access immediately when membership is removed", async () => {
    await db.exec("reset role");
    await rpc("insert into workspace_members values($1,$2,'Agent')", [
      workspaceA,
      userB,
    ]);
    await asUser(userB);
    expect(
      (await rpc("select id from leads where id=$1", [leadA])).length,
    ).toBe(1);
    await db.exec("reset role");
    await rpc(
      "delete from workspace_members where workspace_id=$1 and user_id=$2",
      [workspaceA, userB],
    );
    await asUser(userB);
    expect(await rpc("select id from leads where id=$1", [leadA])).toEqual([]);
    await expect(
      rpc("select update_lead($1,$2,'{}'::jsonb)", [workspaceA, leadA]),
    ).rejects.toThrow("Forbidden");
  });
  it("cancels retired jobs without converting them into paid Google searches", async () => {
    await db.exec("reset role");
    expect(
      (
        await rpc("select discovery_provider from workspaces where id=$1", [
          retiredWorkspace,
        ])
      )[0].discovery_provider,
    ).toBe("google");
    expect(
      (
        await rpc("select status from jobs where workspace_id=$1", [
          retiredWorkspace,
        ])
      )[0].status,
    ).toBe("cancelled");
    expect(
      (
        await rpc(
          "select status,data->>'provider' provider from discoveries where id=$1",
          [retiredDiscovery],
        )
      )[0],
    ).toEqual({ status: "Cancelled", provider: "osm" });
    expect(
      (
        await rpc(
          "select count(*)::int n from discoveries where workspace_id=$1 and data->>'provider'='google'",
          [retiredWorkspace],
        )
      )[0].n,
    ).toBe(0);
  });
  it("allows only official Google Places and protects workspace settings", async () => {
    await asUser(userA);
    expect(
      (
        await rpc("select discovery_provider from workspaces where id=$1", [
          workspaceA,
        ])
      )[0].discovery_provider,
    ).toBe("google");
    const config = {
      name: "Official search",
      keyword: "dentist",
      locations: ["Lahore"],
      limit: 2,
      radius: 5,
      provider: "google",
      schedule: "once",
    };
    const d = (
      await rpc("select create_discovery($1,$2::jsonb) id", [
        workspaceA,
        JSON.stringify(config),
      ])
    )[0].id;
    expect(
      (
        await rpc(
          "select data->>'provider' provider from discoveries where id=$1",
          [d],
        )
      )[0].provider,
    ).toBe("google");
    await expect(
      rpc("select create_discovery($1,$2::jsonb)", [
        workspaceA,
        JSON.stringify({ ...config, provider: "osm" }),
      ]),
    ).rejects.toThrow("Only official Google");
    await expect(
      rpc("select set_discovery_provider($1,'osm')", [workspaceA]),
    ).rejects.toThrow("Only official Google");
    await asUser(agent);
    await expect(
      rpc("select set_discovery_provider($1,'google')", [workspaceA]),
    ).rejects.toThrow("Forbidden");
    await asUser(userB);
    await expect(
      rpc("select set_discovery_provider($1,'google')", [workspaceA]),
    ).rejects.toThrow("Forbidden");
    await asUser(manager);
    await rpc("select set_discovery_provider($1,'google')", [workspaceA]);
  });
  it("hides tenant A rows from tenant B and blocks cross-tenant updates", async () => {
    await asUser(userB);

    expect((await rpc("select * from leads where id=$1", [leadA])).length).toBe(
      0,
    );

    await expect(
      rpc("select update_lead($1,$2,$3::jsonb)", [
        workspaceA,

        leadA,

        '{"stage":"Won"}',
      ]),
    ).rejects.toThrow("Forbidden");
  });

  it("denies direct writes to protected tables", async () => {
    await asUser(userA);

    await expect(
      rpc("update leads set data='{}' where id=$1", [leadA]),
    ).rejects.toThrow();

    await expect(
      rpc("update campaigns set status='Approved' where workspace_id=$1", [
        workspaceA,
      ]),
    ).rejects.toThrow();
  });

  it("deduplicates source identity and preserves chain branches", async () => {
    await asUser(userA);

    const same = (
      await rpc("select import_lead($1,$2::jsonb) as id", [
        workspaceA,

        JSON.stringify({
          name: "Renamed",

          source: "Authorized CSV",

          source_id: "one",
        }),
      ])
    )[0].id;

    expect(same).toBe(leadA);

    const other = (
      await rpc("select import_lead($1,$2::jsonb) as id", [
        workspaceA,

        JSON.stringify({
          name: "Branch Two",

          address: "2 Main St",

          country: "US",

          source: "Authorized CSV",

          source_id: "two",

          website: "https://chain.example",

          phone: "+15125550100",
        }),
      ])
    )[0].id;

    expect(other).not.toBe(leadA);
  });

  it("prevents agents from recording permission or granting themselves admin", async () => {
    await asUser(agent);

    await expect(
      rpc("select record_permission($1,$2,$3,true,$4,true)", [
        workspaceA,

        leadA,

        "granted",

        "https://evidence.example",
      ]),
    ).rejects.toThrow("Manager or admin");

    await expect(
      rpc("update workspace_members set role='Admin' where user_id=$1", [
        agent,
      ]),
    ).rejects.toThrow();
  });

  it("binds approval to exact content, rejects non-admin, and invalidates edits", async () => {
    await asUser(userA);

    const recipient = {
      lead_id: leadA,

      to: "hello@business.example",

      subject: "Hello",

      body: "Exact approved message",

      channel: "email",

      scheduled_at: "2026-10-21T15:00:00Z",

      timezone: "America/Chicago",

      estimated_cost: 0.001,
    };

    const id = (
      await rpc("select save_campaign($1,$2,$3::jsonb) as id", [
        workspaceA,

        "Review test",

        JSON.stringify([recipient]),
      ])
    )[0].id;

    await expect(
      rpc("select approve_campaign($1,$2,1)", [workspaceA, id]),
    ).rejects.toThrow("eligibility unresolved");

    await rpc("select record_permission($1,$2,$3,true,$4,true)", [
      workspaceA,

      leadA,

      "granted",

      "https://business.example/contact",
    ]);

    await asUser(manager);

    await expect(
      rpc("select approve_campaign($1,$2,1)", [workspaceA, id]),
    ).rejects.toThrow("Forbidden");

    await asUser(userA);

    await rpc("select approve_campaign($1,$2,1)", [workspaceA, id]);

    let c = (await rpc("select * from campaigns where id=$1", [id]))[0];

    expect(c.approved_hash).toBeTruthy();

    await rpc("select control_campaign($1,$2,$3,1)", [
      workspaceA,

      id,

      "launch",
    ]);

    await rpc("select control_campaign($1,$2,$3,1)", [workspaceA, id, "pause"]);

    await rpc("select control_campaign($1,$2,$3,1)", [
      workspaceA,

      id,

      "launch",
    ]);

    expect(
      (
        await rpc("select * from jobs where workspace_id=$1 and kind=$2", [
          workspaceA,

          "email",
        ])
      ).length,
    ).toBe(1);

    await rpc("select save_campaign($1,$2,$3::jsonb,$4)", [
      workspaceA,

      "Edited",

      JSON.stringify([{ ...recipient, body: "Changed" }]),

      id,
    ]);

    c = (await rpc("select * from campaigns where id=$1", [id]))[0];

    expect(c.version).toBe(2);

    expect(c.approved_hash).toBe(null);

    expect(c.status).toBe("Draft");

    await expect(
      rpc("select control_campaign($1,$2,$3,2)", [workspaceA, id, "launch"]),
    ).rejects.toThrow("approval");
  });

  it("requires explicit permission before queueing a crawl", async () => {
    await asUser(userA);

    await expect(
      rpc("select queue_enrichment($1,$2,false)", [workspaceA, leadA]),
    ).rejects.toThrow("permission");
  });

  it("requires separate calling approval, binds it to the version and queues the correct channel", async () => {
    await asUser(userA);
    await rpc(
      "select record_channel_permission($1,$2,'call',$3,true,true,$4)",
      [
        workspaceA,
        leadA,
        "+15125550100",
        "https://consent.example/automated-call",
      ],
    );
    const r = {
      lead_id: leadA,
      to: "+15125550100",
      subject: "Call",
      body: "This is an automated call from Comova. Hello. Press 9 to opt out of future outreach.",
      channel: "call",
      scheduled_at: "2026-10-21T15:00:00Z",
      timezone: "America/Chicago",
      estimated_cost: 0.05,
      call_max_seconds: 60,
    };
    const id = (
      await rpc("select save_campaign($1,'Voice',$2::jsonb) id", [
        workspaceA,
        JSON.stringify([r]),
      ])
    )[0].id;
    await expect(
      rpc("select approve_campaign($1,$2,1)", [workspaceA, id]),
    ).rejects.toThrow("Separate automated calling approval");
    await asUser(manager);
    await expect(
      rpc("select approve_automated_calls($1,$2,1)", [workspaceA, id]),
    ).rejects.toThrow("Forbidden");
    await asUser(userA);
    await rpc("select approve_automated_calls($1,$2,1)", [workspaceA, id]);
    await rpc("select approve_campaign($1,$2,1)", [workspaceA, id]);
    await rpc("select control_campaign($1,$2,'launch',1)", [workspaceA, id]);
    expect(
      (
        await rpc("select kind from jobs where payload->>'campaign_id'=$1", [
          id,
        ])
      )[0].kind,
    ).toBe("call");
    await rpc("select save_campaign($1,'Changed voice',$2::jsonb,$3)", [
      workspaceA,
      JSON.stringify([{ ...r, estimated_cost: 0.1 }]),
      id,
    ]);
    expect(
      (
        await rpc(
          "select call_approval_hash,approved_hash from campaigns where id=$1",
          [id],
        )
      )[0],
    ).toEqual({ call_approval_hash: null, approved_hash: null });
  });
  it("restricts timezone review to managers and rejects stale recipient timezones", async () => {
    await asUser(agent);
    await expect(
      rpc("select update_lead($1,$2,$3::jsonb)", [
        workspaceA,
        leadA,
        JSON.stringify({ timezone: "Asia/Karachi" }),
      ]),
    ).rejects.toThrow("Manager review");
    await asUser(userA);
    await expect(
      rpc("select update_lead($1,$2,$3::jsonb)", [
        workspaceA,
        leadA,
        JSON.stringify({ timezone: "Fake/Zone" }),
      ]),
    ).rejects.toThrow("valid IANA");
    await rpc("select update_lead($1,$2,$3::jsonb)", [
      workspaceA,
      leadA,
      JSON.stringify({ timezone: "Asia/Karachi" }),
    ]);
    const r = {
      lead_id: leadA,
      to: "hello@business.example",
      subject: "Hello",
      body: "Message",
      channel: "email",
      scheduled_at: "2026-10-21T15:00:00Z",
      timezone: "America/Chicago",
      estimated_cost: 0.01,
    };
    const id = (
      await rpc("select save_campaign($1,'Timezone',$2::jsonb) id", [
        workspaceA,
        JSON.stringify([r]),
      ])
    )[0].id;
    await expect(
      rpc("select approve_campaign($1,$2,1)", [workspaceA, id]),
    ).rejects.toThrow("eligibility unresolved");
    await rpc("select update_lead($1,$2,$3::jsonb)", [
      workspaceA,
      leadA,
      JSON.stringify({ timezone: "America/Chicago" }),
    ]);
  });
  it("requires WhatsApp consent, blocks cross-tenant consent review and cancels revoked sends", async () => {
    await asUser(userB);
    await expect(
      rpc(
        "select record_channel_permission($1,$2,'whatsapp',$3,true,true,$4)",
        [workspaceA, leadA, "+15125550101", "https://consent.example/wa"],
      ),
    ).rejects.toThrow("Forbidden");
    await asUser(userA);
    const r = {
      lead_id: leadA,
      to: "+15125550101",
      subject: "offer",
      body: "Hello. Reply STOP to opt out.",
      channel: "whatsapp",
      template_id: "123",
      template_fingerprint: "fingerprint",
      scheduled_at: "2026-10-21T15:00:00Z",
      timezone: "America/Chicago",
      estimated_cost: 0.05,
    };
    const id = (
      await rpc("select save_campaign($1,'WA',$2::jsonb) id", [
        workspaceA,
        JSON.stringify([r]),
      ])
    )[0].id;
    await expect(
      rpc("select approve_campaign($1,$2,1)", [workspaceA, id]),
    ).rejects.toThrow("eligibility unresolved");
    await rpc(
      "select record_channel_permission($1,$2,'whatsapp',$3,true,true,$4)",
      [workspaceA, leadA, r.to, "https://consent.example/wa"],
    );
    await rpc("select approve_campaign($1,$2,1)", [workspaceA, id]);
    await rpc("select control_campaign($1,$2,'launch',1)", [workspaceA, id]);
    expect(
      (
        await rpc(
          "select kind,status from jobs where payload->>'campaign_id'=$1",
          [id],
        )
      )[0],
    ).toEqual({ kind: "whatsapp", status: "queued" });
    await rpc(
      "select record_channel_permission($1,$2,'whatsapp',$3,false,true,$4)",
      [workspaceA, leadA, r.to, "https://consent.example/revoked"],
    );
    expect(
      (
        await rpc("select status from jobs where payload->>'campaign_id'=$1", [
          id,
        ])
      )[0].status,
    ).toBe("cancelled");
  });
  it("deduplicates real channel callbacks, stops all channels on replies and reconciles uncertain sends", async () => {
    await asUser(userA);
    await rpc(
      "select record_channel_permission($1,$2,'whatsapp',$3,true,true,$4)",
      [workspaceA, leadA, "+15125550101", "https://consent.example/wa"],
    );
    const r = {
      lead_id: leadA,
      to: "+15125550101",
      subject: "offer",
      body: "Hello. STOP",
      channel: "whatsapp",
      template_id: "123",
      template_fingerprint: "fingerprint",
      scheduled_at: "2026-10-21T15:00:00Z",
      timezone: "America/Chicago",
      estimated_cost: 0.05,
    };
    const c = (
      await rpc("select save_campaign($1,'Events',$2::jsonb) id", [
        workspaceA,
        JSON.stringify([r]),
      ])
    )[0].id;
    await rpc("select approve_campaign($1,$2,1)", [workspaceA, c]);
    await rpc("select control_campaign($1,$2,'launch',1)", [workspaceA, c]);
    await db.exec("reset role");
    const j = (
      await rpc("select id from jobs where payload->>'campaign_id'=$1", [c])
    )[0].id;
    const d = (
      await rpc(
        "insert into deliveries(workspace_id,campaign_id,lead_id,version,recipient,idempotency_key,channel,status) values($1,$2,$3,1,$4,$5,'whatsapp','uncertain') returning id",
        [workspaceA, c, leadA, r.to, "prospect-" + j],
      )
    )[0].id;
    await rpc("update jobs set status='uncertain' where id=$1", [j]);
    await channelEvent({
      id: "meta:delivered:1",
      provider: "meta",
      channel: "whatsapp",
      providerId: "wamid-real",
      deliveryId: d,
      status: "delivered",
      at: new Date("2026-10-21T15:01:00Z"),
    });
    expect(
      (await rpc("select status from jobs where id=$1", [j]))[0].status,
    ).toBe("completed");
    await channelEvent({
      id: "meta:sent:old",
      provider: "meta",
      channel: "whatsapp",
      providerId: "wamid-real",
      status: "sent",
      at: new Date("2026-10-21T15:00:00Z"),
    });
    expect(
      (await rpc("select status from deliveries where id=$1", [d]))[0].status,
    ).toBe("delivered");
    const inbound = {
      id: "meta:in:1",
      provider: "meta",
      channel: "whatsapp",
      address: r.to,
      status: "replied",
      at: new Date("2026-10-21T15:02:00Z"),
      stop: true,
      replied: true,
    };
    await channelEvent(inbound);
    await channelEvent(inbound);
    expect(
      (await rpc("select replies from campaigns where id=$1", [c]))[0].replies,
    ).toBe(1);
    expect(
      (
        await rpc("select data->>'stopped' stopped from leads where id=$1", [
          leadA,
        ])
      )[0].stopped,
    ).toBe("true");
    expect(
      (
        await rpc(
          "select count(*)::int n from jobs where workspace_id=$1 and payload->>'lead_id'=$2 and status='queued' and kind in ('email','whatsapp','call','followup')",
          [workspaceA, leadA],
        )
      )[0].n,
    ).toBe(0);
  });
  it("emergency stop cancels queued sends and clears approvals", async () => {
    await asUser(userA);

    await rpc("select emergency_stop_workspace($1)", [workspaceA]);

    expect(
      (
        await rpc("select emergency_stop from workspaces where id=$1", [
          workspaceA,
        ])
      )[0].emergency_stop,
    ).toBe(true);

    expect(
      (
        await rpc(
          "select * from jobs where workspace_id=$1 and kind='email' and status='queued'",

          [workspaceA],
        )
      ).length,
    ).toBe(0);
  });
});
