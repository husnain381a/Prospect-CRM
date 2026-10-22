"use client";

import { LoaderCircle, LockKeyhole, RefreshCw, LogOut } from "lucide-react";
import { Button } from "./ui/button";

type Credentials = { email: string; password: string };

export function SignInForm({
  configured,
  busy,
  error,
  onSignIn,
}: {
  configured: boolean;
  busy: boolean;
  error: string;
  onSignIn: (credentials: Credentials) => Promise<void>;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void onSignIn({
          email: String(form.get("email")),
          password: String(form.get("password")),
        });
      }}
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <label>
        Email
        <input
          type="email"
          name="email"
          autoComplete="username"
          required
          disabled={busy || !configured}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          disabled={busy || !configured}
        />
      </label>
      <Button disabled={!configured || busy} className="full-width">
        {busy ? (
          <LoaderCircle size={16} className="spin" aria-hidden="true" />
        ) : (
          <LockKeyhole size={16} aria-hidden="true" />
        )}
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export function WorkspaceAccess({
  mode,
  configured,
  busy,
  error,
  onSignIn,
  onRetry,
  onSignOut,
}: {
  mode: "loading" | "signed_out" | "error";
  configured: boolean;
  busy: boolean;
  error: string;
  onSignIn: (credentials: Credentials) => Promise<void>;
  onRetry: () => void;
  onSignOut: () => Promise<void>;
}) {
  return (
    <main className="workspace-access" aria-busy={mode === "loading"}>
      <section className="card workspace-access-card">
        <a className="brand" href="/" aria-label="Prospect home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          prospect<span className="brand-dot">.</span>
        </a>
        {mode === "loading" ? (
          <div className="workspace-loading" role="status" aria-live="polite">
            <LoaderCircle className="spin" size={30} aria-hidden="true" />
            <h1>Loading your workspace</h1>
            <p>Checking your session and loading your data…</p>
          </div>
        ) : mode === "error" ? (
          <>
            <h1>Couldn’t load your workspace</h1>
            <p className="form-error" role="alert">
              {error || "Please check your connection and try again."}
            </p>
            <div className="workspace-access-actions">
              <Button onClick={onRetry} disabled={busy}>
                <RefreshCw size={16} aria-hidden="true" />
                Try again
              </Button>
              <Button
                variant="outline"
                onClick={() => void onSignOut()}
                disabled={busy}
              >
                <LogOut size={16} aria-hidden="true" />
                Sign out
              </Button>
            </div>
          </>
        ) : configured ? (
          <>
            <h1>Sign in to your workspace</h1>
            <p>
              Access is limited to approved workspace members. Contact your
              administrator for an account.
            </p>
            <SignInForm
              configured={configured}
              busy={busy}
              error={error}
              onSignIn={onSignIn}
            />
          </>
        ) : (
          <>
            <h1>Workspace setup required</h1>
            <p>
              Contact your administrator to finish connecting the workspace.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
