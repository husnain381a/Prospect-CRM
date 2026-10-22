import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requestOriginAllowed } from "@/lib/request-origin";
import { AccessError, approvedMembership } from "@/lib/supabase/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
const denied =
  "Unable to sign in. Check your credentials or contact your administrator.";

export async function POST(request: Request) {
  if (!requestOriginAllowed(request))
    return Response.json(
      { error: "Invalid request origin" },
      { status: 403, headers },
    );
  try {
    const raw = await request.text();
    if (raw.length > 4096)
      return Response.json(
        { error: "Payload too large" },
        { status: 413, headers },
      );
    const credentials = z
      .object({
        email: z.string().trim().email().max(254),
        password: z.string().min(1).max(1024),
      })
      .strict()
      .parse(JSON.parse(raw));
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key)
      throw new AccessError(
        503,
        "Setup required: configure Supabase environment variables",
      );
    // Supabase enforces its Auth rate limits. Do not store a browser session
    // until the authenticated user has an approved workspace membership.
    const db = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const { data, error } = await db.auth.signInWithPassword(credentials);
    if (error || !data.user || !data.session)
      return Response.json(
        {
          error:
            error?.status === 429
              ? "Too many attempts. Please try again later."
              : denied,
        },
        { status: error?.status === 429 ? 429 : 401, headers },
      );
    try {
      await approvedMembership(db, data.user);
    } catch (error) {
      await db.auth.signOut({ scope: "local" });
      throw error;
    }
    return Response.json(
      {
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        },
      },
      { headers },
    );
  } catch (error) {
    const status =
      error instanceof AccessError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 503;
    return Response.json(
      {
        error:
          status === 503
            ? "Sign-in is temporarily unavailable. Please try again."
            : status === 400
              ? "Enter a valid email and password."
              : denied,
      },
      { status, headers },
    );
  }
}
