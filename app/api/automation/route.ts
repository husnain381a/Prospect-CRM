import { authorize } from "@/lib/supabase/server";
import { AccessError } from "@/lib/supabase/access";
import {
  configured,
  channelEnabled,
  listTemplates,
  templateBody,
} from "@/lib/adapters/channels";
import { googleReady } from "@/lib/adapters/google";
export async function GET(request: Request) {
  try {
    const u = new URL(request.url),
      w = u.searchParams.get("workspace") || "";
    const { db, role } = await authorize(w);
    if (u.searchParams.get("templates") === "1") {
      if (role === "Agent")
        return Response.json(
          { error: "Manager or admin required" },
          { status: 403 },
        );
      const templates = await listTemplates();
      return Response.json(
        {
          templates: templates.map((t) => {
            let supported = true;
            try {
              const text =
                t.components.find((c) => c.type === "BODY")?.text || "";
              const count = Math.max(
                0,
                ...[...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) =>
                  Number(m[1]),
                ),
              );
              templateBody(t, Array(count).fill("example"));
            } catch {
              supported = false;
            }
            return { ...t, supported };
          }),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const { data: jobs, error } = await db
      .from("jobs")
      .select("id,kind,status,attempts,run_at,last_error,created_at")
      .eq("workspace_id", w)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw Error(error.message);
    return Response.json(
      {
        providers: {
          google: googleReady(),
          whatsapp: configured("whatsapp"),
          call: configured("call"),
          email: configured("email"),
        },
        enabled: {
          email: true,
          whatsapp: channelEnabled("whatsapp"),
          call: channelEnabled("call"),
        },
        jobs,
        role,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const m = e instanceof Error ? e.message : "Automation unavailable";
    return Response.json(
      { error: m },
      {
        status: e instanceof AccessError ? e.status : 503,
        headers: { "Cache-Control": "no-store, private" },
      },
    );
  }
}
