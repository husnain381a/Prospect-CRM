import { authorize } from "@/lib/supabase/server";
import { AccessError } from "@/lib/supabase/access";
import { z } from "zod";
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const id = z.string().uuid().parse(p.get("workspace"));
    const { db } = await authorize(id);
    const page = Math.max(1, Number(p.get("page")) || 1);
    const size = Math.max(1, Math.min(100, Number(p.get("size")) || 25));
    let q = db
      .from("leads")
      .select("*", { count: "exact" })
      .eq("workspace_id", id);
    const status = p.get("website");
    if (status && status !== "all")
      q = q.eq(
        "data->>website_status",
        z.enum(["found", "not_found", "unverified"]).parse(status),
      );
    const stage = p.get("stage");
    if (stage && stage !== "all")
      q = q.eq(
        "data->>stage",
        z
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
          .parse(stage),
      );
    const search = p.get("search")?.slice(0, 150);
    if (search)
      q = q.textSearch("search_document", search, {
        config: "simple",
        type: "websearch",
      });
    q =
      p.get("sort") === "score"
        ? q.order("opportunity_score", { ascending: false })
        : p.get("sort") === "name"
          ? q.order("data->>name")
          : q.order("created_at", { ascending: false });
    const { data, error, count } = await q.range(
      (page - 1) * size,
      page * size - 1,
    );
    if (error) throw error;
    return Response.json(
      {
        leads: (data || []).map((x) => ({
          ...x.data,
          id: x.id,
          workspace_id: x.workspace_id,
          created_at: x.created_at,
        })),
        count,
        page,
        size,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Invalid query" },
      {
        status: e instanceof AccessError ? e.status : 400,
        headers: { "Cache-Control": "no-store, private" },
      },
    );
  }
}
