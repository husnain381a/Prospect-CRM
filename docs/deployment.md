# Deployment

## Frontend/API service

Deploy as a Node.js 24 Next.js App Router service (for example Vercel, a container host, or a conventional Node process). Build with `npm ci && npm run build`; start with `npm start`. Provide the public Supabase URL/key **at build time** because Next.js embeds public client environment variables.

The frontend's API handlers also need `APP_URL`, the unsubscribe secret, Resend settings, `RESEND_WEBHOOK_SECRET`, and `DATABASE_URL` for verified event/suppression transactions. Discovery creation checks its Google Places API key. Set Google, Meta and Twilio variables on the web service and worker when enabling those channels. The web service verifies templates and serves the voice/webhook endpoints. Secrets remain server-only. `SUPABASE_SECRET_KEY` is reserved for optional future admin tooling and is unused by this implementation.

Serve HTTPS through the host proxy, set the exact canonical `APP_URL`, and configure Supabase's allowed auth URLs. Do not publicly expose database credentials or the worker's health endpoint. The application sets nosniff, referrer, frame and permissions headers. Tighten the deployment's CSP with your actual Supabase/asset domains after browser validation; the starter does not claim a fully nonce-based CSP.

## Worker service

Deploy `Dockerfile.worker` as a separate always-on service. Supply environment variables at runtime and use the same database/provider configuration as the frontend. `npx tsx worker/index.ts` is the entry point. The worker is not a Next.js request, serverless cron, or in-memory queue. It requires durable PostgreSQL tables and a long-lived connection pool. Start with `WORKER_CONCURRENCY=2`; jobs are claimed atomically. Graceful shutdown drains accepted work for up to 25 seconds.

The worker health server listens on `PORT` (default 3001). Configure an **internal** health check to `GET /`. The frontend health endpoint `/api/health` verifies process readiness only, not database health. Monitor worker heartbeat freshness independently.

`compose.yaml` demonstrates two local containers pointing at an external Supabase project:

```sh
docker compose --env-file .env.local up --build -d
```

Docker was not available in the build environment, so container builds are supplied but not executed here. Do not bind mount production environment files into a public static directory. The worker image includes `tsx` from development dependencies; do not prune it without compiling the worker to JavaScript first.

## Database rollout

Back up before a schema change. Apply migrations in numeric order to a fresh project and inspect their grants. Use staging first. The migrations assume Supabase Auth, Storage and `supabase_realtime`; hosted behavior must be checked in your project. Only authenticated users can read tenant tables; direct client mutations are revoked. Mutation functions validate membership/roles independently. The workspace-files bucket is private with workspace-ID path policies; a file-management UI is not included.

## Activation checks

Before enabling real outreach, exercise the configured accounts with approved internal test recipients: tenant A/B isolation, signature rejection/replay, exact footer preview, approval invalidation after each edit, per-recipient permission review, pause/resume/stop, local-time deferral, provider 429 behavior, ambiguous delivery reconciliation, reply/bounce/complaint/opt-out suppression and lease recovery. Configure licensed source quotas and monitor costs. Keep demo data outside live projects.

Suggested initial **targets**, to validate with staging load tests: web availability 99.5% monthly; p95 paginated lead query under 500 ms at 100,000 leads/workspace; p95 non-provider API latency under 750 ms; due eligible jobs claimed within 15 seconds; uncertain delivery alert within 60 seconds. These are goals, not measured claims or zero-downtime guarantees. Backups and operator on-call procedures determine recovery reliability.

See [automation setup](automation-setup.md) for the exact HTTPS callback URLs and activation flow.
