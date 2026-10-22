import { z } from "zod";
import { authorize } from "@/lib/supabase/server";
import { AccessError } from "@/lib/supabase/access";
import { importRecord } from "@/lib/import";
import { unsubscribeToken } from "@/lib/unsubscribe";
import { googleReady } from "@/lib/adapters/google";
import { requestOriginAllowed } from "@/lib/request-origin";
import {
  requireChannel,
  getTemplate,
  templateBody,
  templateFingerprint,
} from "@/lib/adapters/channels";
const uuid = z.string().uuid();
const recipient = z.object({
  lead_id: uuid,
  to: z.string().min(3).max(254),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(20000),
  scheduled_at: z.string().datetime(),
  timezone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, "IANA timezone required"),
  channel: z.enum(["email", "whatsapp", "call"]),
  template_id: z
    .string()
    .regex(/^\d{1,40}$/)
    .optional(),
  template_parameters: z.array(z.string().min(1).max(1000)).max(20).optional(),
  call_max_seconds: z.number().int().min(15).max(120).optional(),
  estimated_cost: z.number().min(0).max(100),
});
export async function POST(request: Request) {
  try {
    if (!requestOriginAllowed(request))
      return Response.json(
        { error: "Invalid request origin" },
        { status: 403 },
      );
    const raw = await request.text();
    if (raw.length > 2_000_000)
      return Response.json({ error: "Payload too large" }, { status: 413 });
    const input = z
      .object({
        workspace_id: uuid,
        action: z.string(),
        payload: z.record(z.string(), z.unknown()),
      })
      .parse(JSON.parse(raw));
    const { db, role } = await authorize(input.workspace_id);
    const w = input.workspace_id;
    const p = input.payload;
    let result: unknown;
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await db.rpc(name, args);
      if (error) throw Error(error.message);
      return data;
    };
    switch (input.action) {
      case "import": {
        const rows = z.array(z.unknown()).min(1).max(500).parse(p.rows);
        const valid = rows.map((r) => importRecord(r));
        const ids = [];
        for (const data of valid)
          ids.push(await rpc("import_lead", { w, d: data }));
        result = { ids, unique: new Set(ids).size };
        break;
      }
      case "create_lead":
        result = await rpc("import_lead", {
          w,
          d: importRecord(
            { ...p, export_allowed: true },
            "Authorized manual entry",
          ),
        });
        break;
      case "update_lead":
        result = await rpc("update_lead", {
          w,
          lead: uuid.parse(p.id),
          patch: z
            .object({
              stage: z
                .enum([
                  "New",
                  "Qualified",
                  "Approved",
                  "Contacted",
                  "Replied",
                  "Meeting",
                  "Proposal",
                  "Won",
                  "Lost",
                ])
                .optional(),
              owner: z.string().max(100).optional(),
              tags: z.array(z.string().max(50)).max(25).optional(),
              notes: z.array(z.string().max(10000)).max(200).optional(),
              website_status: z
                .enum(["found", "not_found", "unverified"])
                .optional(),
              stopped: z.boolean().optional(),
              timezone: z
                .string()
                .refine((v) => {
                  try {
                    new Intl.DateTimeFormat("en", { timeZone: v });
                    return true;
                  } catch {
                    return false;
                  }
                }, "Valid recipient timezone required")
                .optional(),
            })
            .strict()
            .parse(p.patch),
        });
        break;
      case "bulk_stage": {
        const ids = z.array(uuid).max(500).parse(p.ids);
        const stage = z
          .enum([
            "New",
            "Qualified",
            "Approved",
            "Contacted",
            "Replied",
            "Meeting",
            "Proposal",
            "Won",
            "Lost",
          ])
          .parse(p.stage);
        for (const id of ids)
          await rpc("update_lead", { w, lead: id, patch: { stage } });
        break;
      }
      case "record_permission":
        result = await rpc("record_permission", {
          w,
          lead: uuid.parse(p.id),
          permission: z
            .enum(["granted", "unresolved", "denied"])
            .parse(p.email_permission),
          jurisdiction: z.boolean().parse(p.jurisdiction_approved),
          evidence: z
            .string()
            .url()
            .startsWith("https://")
            .parse(p.evidence_url),
          verified: z.boolean().parse(p.email_verified),
        });
        break;
      case "create_task":
        result = await rpc("save_task", {
          w,
          t: z
            .object({
              title: z.string().min(1).max(300),
              lead_id: z.union([uuid, z.literal("")]),
              owner: z.string().max(100),
              due_at: z.string().datetime(),
            })
            .parse(p),
        });
        break;
      case "complete_task":
        result = await rpc("complete_task", {
          w,
          task: uuid.parse(p.id),
          completed: z.boolean().parse(p.done),
        });
        break;
      case "discover": {
        const d = z
          .object({
            name: z.string().min(1).max(200),
            keyword: z.string().min(1).max(200),
            locations: z.array(z.string().min(1).max(200)).min(1).max(25),
            limit: z.number().int().min(1).max(500),
            radius: z.number().min(1).max(500),
            exclusions: z.array(z.string().max(200)).max(100),
            schedule: z.enum(["once", "daily", "weekly"]),
            estimated_cost: z.number().min(0),
            provider: z.literal("google").default("google"),
            auto_enrich: z.boolean().default(false),
          })
          .parse(p);
        if (d.provider === "google" && !googleReady())
          throw Error("Setup required: Google Places API key");
        result = await rpc("create_discovery", { w, d });
        break;
      }
      case "set_discovery_provider":
        result = await rpc("set_discovery_provider", {
          w,
          provider: z.literal("google").parse(p.provider),
        });
        break;
      case "cancel_discovery":
        result = await rpc("cancel_discovery", {
          w,
          discovery: uuid.parse(p.id),
        });
        break;
      case "record_channel_permission":
        result = await rpc("record_channel_permission", {
          w,
          lead: uuid.parse(p.id),
          channel: z.enum(["whatsapp", "call"]).parse(p.channel),
          address: z
            .string()
            .regex(/^\+[1-9][0-9]{6,14}$/)
            .parse(p.address),
          granted: z.boolean().parse(p.granted),
          jurisdiction: z.boolean().parse(p.jurisdiction_approved),
          evidence: z
            .string()
            .url()
            .startsWith("https://")
            .parse(p.evidence_url),
        });
        break;
      case "approve_automated_calls":
        requireChannel("call");
        result = await rpc("approve_automated_calls", {
          w,
          campaign: uuid.parse(p.id),
          v: z.number().int().positive().parse(p.version),
        });
        break;
      case "create_campaign":
      case "edit_campaign":
        const parsed = z.array(recipient).min(1).max(500).parse(p.recipients);
        const recipients = [];
        for (const r of parsed) {
          if (r.channel === "whatsapp") {
            requireChannel("whatsapp");
            if (!/^\+[1-9][0-9]{6,14}$/.test(r.to))
              throw Error("E.164 WhatsApp address required");
            const t = await getTemplate(r.template_id || "");
            recipients.push({
              ...r,
              body: templateBody(t, r.template_parameters || []),
              template: t.name,
              template_language: t.language,
              template_fingerprint: templateFingerprint(t),
            });
          } else if (r.channel === "call") {
            if (
              !/^\+[1-9][0-9]{6,14}$/.test(r.to) ||
              !r.body.startsWith("This is an automated call from ") ||
              !r.body.endsWith("Press 9 to opt out of future outreach.")
            )
              throw Error(
                "Call requires E.164 number, automation disclosure and opt-out instruction",
              );
            recipients.push({
              ...r,
              call_max_seconds: r.call_max_seconds || 60,
            });
          } else {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.to))
              throw Error("Valid email required");
            if (!process.env.UNSUBSCRIBE_SECRET || !process.env.APP_URL)
              throw Error("Setup required: unsubscribe signing and APP_URL");
            const url = new URL(
              "/unsubscribe?token=" + unsubscribeToken(w, r.to),
              process.env.APP_URL,
            ).toString();
            recipients.push({
              ...r,
              unsubscribe_url: url,
              body: r.body + "\n\nUnsubscribe: " + url,
            });
          }
        }
        result = await rpc("save_campaign", {
          w,
          campaign_name: z.string().min(1).max(200).parse(p.name),
          rs: recipients,
          campaign: input.action === "edit_campaign" ? uuid.parse(p.id) : null,
        });
        break;
      case "campaign_approve":
        const { data: approvalDraft, error: approvalDraftError } = await db
          .from("campaigns")
          .select("recipients")
          .eq("workspace_id", w)
          .eq("id", uuid.parse(p.id))
          .single();
        if (approvalDraftError || !approvalDraft)
          throw Error("Campaign not found");
        for (const item of approvalDraft.recipients) {
          requireChannel(item.channel);
          if (item.channel !== "email") continue;
          const expected = new URL(
            "/unsubscribe?token=" + unsubscribeToken(w, item.to),
            process.env.APP_URL!,
          ).toString();
          if (
            item.unsubscribe_url !== expected ||
            !item.body.endsWith("\n\nUnsubscribe: " + expected)
          )
            throw Error(
              "Edit and save this draft again so its exact unsubscribe footer can be reviewed before approval.",
            );
        }
        result = await rpc("approve_campaign", {
          w,
          campaign: uuid.parse(p.id),
          v: z.number().int().positive().parse(p.version),
        });
        break;
      case "enrich":
        result = await rpc("queue_enrichment", {
          w,
          lead: uuid.parse(p.id),
          permission: z.literal(true).parse(p.permission),
        });
        break;
      case "configure_scoring":
        result = await rpc("configure_scoring", {
          w,
          weights: z
            .object({
              rating: z.number().min(0).max(1),
              volume: z.number().min(0).max(1),
              fit: z.number().min(0).max(1),
              website: z.number().min(0).max(1),
              contact: z.number().min(0).max(1),
            })
            .parse(p.weights),
        });
        break;
      case "campaign_launch": {
        const { data: c, error } = await db
          .from("campaigns")
          .select("recipients")
          .eq("workspace_id", w)
          .eq("id", uuid.parse(p.id))
          .single();
        if (error || !c) throw Error("Campaign not found");
        for (const r of c.recipients) requireChannel(r.channel);
      }
      case "campaign_pause":
      case "campaign_stop":
        result = await rpc("control_campaign", {
          w,
          campaign: uuid.parse(p.id),
          operation: input.action.split("_")[1],
          v: z.number().int().positive().parse(p.version),
        });
        break;
      case "emergency_stop":
        result = await rpc("emergency_stop_workspace", { w, stopped: true });
        break;
      case "log_call":
        result = await rpc("log_call", { w, lead: uuid.parse(p.lead_id) });
        break;
      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
    return Response.json({ ok: true, result, role });
  } catch (e) {
    const message =
      e instanceof z.ZodError
        ? e.issues.map((x) => x.message).join("; ")
        : e instanceof Error
          ? e.message
          : "Action failed";
    const status =
      e instanceof AccessError
        ? e.status
        : message === "Authentication required"
          ? 401
          : message === "Forbidden"
            ? 403
            : message.startsWith("Setup required")
              ? 503
              : 400;
    return Response.json({ error: message }, { status });
  }
}
