import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AccessError, approvedMembership } from "./access";
export async function serverClient() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    throw Error("Setup required: configure Supabase environment variables");
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (values) => {
          for (const { name, value, options } of values)
            jar.set(name, value, options);
        },
      },
    },
  );
}
export async function authorize(workspace?: string) {
  const db = await serverClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) throw new AccessError(401, "Authentication required");
  const membership = await approvedMembership(db, user, workspace);
  return { db, user, ...membership };
}
