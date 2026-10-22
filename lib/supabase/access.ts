import type { SupabaseClient, User } from "@supabase/supabase-js";

export class AccessError extends Error {
  constructor(
    public status: 401 | 403 | 503,
    message: string,
  ) {
    super(message);
  }
}

// Membership is an administrator-managed database record, never user metadata.
export async function approvedMembership(
  db: SupabaseClient,
  user: User | null,
  workspace?: string,
) {
  if (!user || user.is_anonymous || !user.email_confirmed_at)
    throw new AccessError(401, "Authentication required");
  let query = db
    .from("workspace_members")
    .select("workspace_id,role")
    .eq("user_id", user.id);
  if (workspace) query = query.eq("workspace_id", workspace);
  const { data, error } = await query
    .order("workspace_id")
    .limit(1)
    .maybeSingle();
  if (error) throw new AccessError(503, "Unable to verify workspace access");
  if (!data || !["Admin", "Manager", "Agent"].includes(data.role))
    throw new AccessError(
      403,
      "Access is restricted to approved workspace members. Contact your administrator.",
    );
  return { workspace: data.workspace_id as string, role: data.role as string };
}
