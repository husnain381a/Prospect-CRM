import { authorize } from "@/lib/supabase/server";
import { AccessError } from "@/lib/supabase/access";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const {
      db,
      user,
      workspace: id,
    } = await authorize(
      new URL(request.url).searchParams.get("workspace") || undefined,
    );
    const results = await Promise.all([
      db.from("workspaces").select("*").eq("id", id).single(),
      db
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", id)
        .eq("user_id", user.id)
        .single(),
      db
        .from("leads")
        .select("*")
        .eq("workspace_id", id)
        .order("created_at", { ascending: false })
        .range(0, 499),
      db
        .from("tasks")
        .select("*")
        .eq("workspace_id", id)
        .order("due_at")
        .limit(500),
      db
        .from("discoveries")
        .select("*")
        .eq("workspace_id", id)
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("campaigns")
        .select("*")
        .eq("workspace_id", id)
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("audit_log")
        .select("*")
        .eq("workspace_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    const failure = results.find((x) => x.error);
    if (failure) throw Error(failure.error!.message);
    const [w, m, l, t, d, c, a] = results;
    if (!w.data || !m.data)
      return Response.json({ error: "Forbidden" }, { status: 403 });
    const { data: metrics, error: metricsError } = await db.rpc(
      "workspace_metrics",
      { w: id },
    );
    if (metricsError) throw Error(metricsError.message);
    return Response.json(
      {
        workspace: w.data,
        role: m.data.role,
        limit: 500,
        metrics,
        state: {
          leads: (l.data || []).map((x: any) => ({
            ...x.data,
            id: x.id,
            workspace_id: x.workspace_id,
            created_at: x.created_at,
          })),
          tasks: t.data || [],
          discoveries: (d.data || []).map((x: any) => ({
            ...x.data,
            id: x.id,
            status: x.status,
            progress: x.progress,
            created_at: x.created_at,
          })),
          campaigns: c.data || [],
          activity: (a.data || []).map((x: any) => ({
            id: String(x.id),
            title: x.event.replaceAll(".", " "),
            detail: x.entity_id || "Workspace activity",
            time: x.created_at,
            kind: "lead",
          })),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to load workspace" },
      {
        status: e instanceof AccessError ? e.status : 503,
        headers: { "Cache-Control": "no-store, private" },
      },
    );
  }
}
