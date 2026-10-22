import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { approvedMembership } from "../lib/supabase/access";
import { POST } from "../app/api/auth/login/route";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const user = {
  id: "10000000-0000-4000-8000-000000000001",
  email_confirmed_at: "2026-10-01T00:00:00Z",
  is_anonymous: false,
} as User;

function client(
  data: unknown = { workspace_id: "approved-workspace", role: "Admin" },
  error: unknown = null,
) {
  const query: any = {};
  for (const method of ["select", "eq", "order", "limit"])
    query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => ({ data, error }));
  const db = {
    from: vi.fn(() => query),
    auth: {
      signInWithPassword: vi.fn(async () => ({
        data: {
          user,
          session: {
            access_token: "approved-token",
            refresh_token: "approved-refresh",
          },
        },
        error: null,
      })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  };
  return { db, query, supabase: db as unknown as SupabaseClient };
}

describe("approved workspace access", () => {
  it("rejects missing, anonymous and unconfirmed identities before querying data", async () => {
    const { db, supabase } = client();
    for (const identity of [
      null,
      { ...user, is_anonymous: true },
      { ...user, email_confirmed_at: undefined },
    ])
      await expect(
        approvedMembership(supabase, identity),
      ).rejects.toMatchObject({ status: 401 });
    expect(db.from).not.toHaveBeenCalled();
  });
  it("checks the actual user and requested workspace in the database", async () => {
    const { supabase, query } = client();
    await expect(
      approvedMembership(supabase, user, "approved-workspace"),
    ).resolves.toEqual({ workspace: "approved-workspace", role: "Admin" });
    expect(query.eq).toHaveBeenCalledWith("user_id", user.id);
    expect(query.eq).toHaveBeenCalledWith("workspace_id", "approved-workspace");
  });
  it("ignores self-assigned admin metadata when membership is missing", async () => {
    const { supabase } = client(null);
    await expect(
      approvedMembership(supabase, {
        ...user,
        user_metadata: { role: "Admin", workspace_id: "approved-workspace" },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("fails closed on database errors and unrecognized roles", async () => {
    await expect(
      approvedMembership(client(null, { message: "offline" }).supabase, user),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      approvedMembership(
        client({ workspace_id: "w", role: "Owner" }).supabase,
        user,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("login endpoint", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test");
    createClient.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());
  function request(
    body: unknown = {
      email: "approved@example.test",
      password: "test-password",
    },
    origin = "https://crm.example.test",
  ) {
    return new Request("https://crm.example.test/api/auth/login", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  it("rejects cross-origin and malformed login attempts before authenticating", async () => {
    expect(
      (await POST(request(undefined, "https://other.example.test"))).status,
    ).toBe(403);
    expect(
      (await POST(request({ email: "invalid", password: "" }))).status,
    ).toBe(400);
    expect((await POST(request({ email: "a".repeat(5000) }))).status).toBe(413);
    expect(createClient).not.toHaveBeenCalled();
  });
  it("returns session tokens only after approval and prevents caching", async () => {
    createClient.mockReturnValue(client().db);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      session: {
        access_token: "approved-token",
        refresh_token: "approved-refresh",
      },
    });
  });
  it("revokes an unapproved login and never returns its tokens", async () => {
    const { db } = client(null);
    createClient.mockReturnValue(db);
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(db.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(await response.text()).not.toMatch(
      /approved-token|approved-refresh|session/,
    );
  });
  it("preserves Supabase rate limiting without disclosing account details", async () => {
    const { db } = client();
    db.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { status: 429 },
    } as any);
    createClient.mockReturnValue(db);
    expect((await POST(request())).status).toBe(429);
    db.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { status: 400, message: "private internal error" },
    } as any);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("private internal error");
  });
});
