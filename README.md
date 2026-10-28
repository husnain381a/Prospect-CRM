# Prospect CRM

A Next.js App Router application for business discovery, qualification, CRM and approval-controlled email, WhatsApp and automated voice calls. The app requires sign-in and loads only the authenticated Supabase workspace. Initial page loads show a loading state; sample records are not part of the application bundle.

## Run the application

Requires Node.js 24 LTS and npm. From this directory:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. Sign in with your workspace account. The app shows loading, sign-in, setup or retry states until the real workspace is available. Dependencies are pinned in `package-lock.json`. Webpack is selected because the Windows sandbox denied Turbopack junction creation.

## Connect a real workspace

1. Copy `.env.example` to `.env.local` and set the Supabase URL and publishable key.
2. In a **fresh Supabase project**, apply all files in `supabase/migrations/` in numeric order. They create tables, indexes, RLS, restricted mutation functions, storage policies, and realtime publication membership. The first migration revokes public function execution; do not apply it blindly to an existing unrelated application schema.
3. Create the initial users in Supabase Auth. Provision a workspace with a trusted administrator database connection:

```sql
-- Replace BOTH placeholders. Keep user IDs private.
insert into public.workspaces(name) values ('Your team') returning id;
insert into public.workspace_members(workspace_id,user_id,role)
values ('WORKSPACE_UUID','AUTH_USER_UUID','Admin');
```

Workspace creation and membership changes require a trusted administrator database connection. Signed-in users cannot create a workspace or grant themselves access. Allowed roles: Admin, Manager, Agent. Membership administration is not exposed as a self-service UI.

In Supabase **Authentication → Sign In / Providers**, disable **Allow new users to sign up** and **Allow anonymous sign-ins**. Create or invite accounts through Supabase Auth, then add their `workspace_members` record through the trusted admin connection above. An Auth account alone does not grant CRM access. Login checks membership on the server before returning session tokens; every protected API checks it again. Removing membership revokes workspace access on subsequent requests, even while an old access token remains valid.

4. Restart the frontend and sign in. No local sample data is loaded or copied to Supabase. On initial sign-in the first membership is selected; multiple tenants are supported by the API, while the workspace picker UI currently chooses the first membership.
5. Set `DATABASE_URL` for the worker and verified webhook handlers. Use the direct or session-mode Supabase pooler connection with TLS. Never expose this URL or a secret/service key through `NEXT_PUBLIC_*` variables.

## Run the separate durable worker

```sh
npm run worker
```

The script reads `.env.local`. In managed deployments use `npx tsx worker/index.ts` and inject environment variables instead of shipping an environment file. Queue state is stored in PostgreSQL; Redis is not required. Jobs use `FOR UPDATE SKIP LOCKED`, leases, checkpoints, bounded retries and a persistent dead-letter/uncertain state. Run a separate process/container from the frontend. See [deployment](docs/deployment.md) and [operations](docs/operations.md).

## What is implemented

| Milestone | Delivered behavior |
| --- | --- |
| Discovery / CRM | Multi-location keyword searches, radius, exclusions, result limits, saved daily/weekly jobs, cancellation, licensed provider contract, authorized CSV/manual import, source identity and branch-aware deduplication, provenance, three website segments, basic permitted website audit, two independently weighted scores, searchable paginated leads, CSV export with record-level export permission, tags, owners, notes, tasks, pipeline, activity history. |
| Approvals / email | Personalized drafts, one optional scheduled follow-up, exact-recipient/message/schedule/channel/cost preview, version-bound admin approvals, edit invalidation, durable launch, pause/resume/stop, workspace emergency stop, permission/jurisdiction/evidence review, recipient-local weekday sending hours, persisted rate limits, stable provider idempotency, signed unsubscribe, suppression, signature-verified delivery/bounce/complaint/inbound webhooks. |
| Infrastructure | Supabase Auth, membership-based RLS, deny-by-default direct mutations, audited permission decisions, private workspace Storage bucket policies, Realtime lead/job refresh, separate worker health endpoint, Dockerfiles, migration tests, adapter contracts, recovery runbook. |
| Automation | Official Google Places discovery, email-first composer and retained paused advanced channels; direct Google Places Text Search using the configured server API key; daily/weekly collection and optional website enrichment; Meta-approved text templates and exact parameter snapshots; explicit WhatsApp/calling consent review; separate version-bound call approval; durable scheduled sends; signed Meta/Twilio callbacks; spoken disclosure, press-9 opt-out, reply suppression and uncertain-outcome reconciliation. Use the **Automation** sidebar view. |

## Official Google Places

Discovery now uses **official Google Places API (New)** only. The OpenStreetMap option, public-provider network code and its environment settings have been removed. Comova defaults to Google. Queued retired-source searches are cancelled rather than converted into paid Google requests. Authorized CSV/manual import remains available.

Email remains the default outreach channel. WhatsApp and automated calling are retained and paused using `WHATSAPP_ENABLED=false` and `AUTOMATED_CALLS_ENABLED=false`.

See [Google Places setup](docs/google-places.md) for the required Google configuration.

## Configure discovery

Set `LICENSED_DISCOVERY_URL` and `LICENSED_DISCOVERY_TOKEN` in the web and worker environments. Your provider must implement [the contract](docs/provider-contract.md) and authorize storage/export. The worker does not assume that an ordinary API subscription grants these rights. Sources can return partial coverage and costs. Imported records with missing website data remain **Needs verification**. Manually marking **No website found** is a qualification finding, not proof of universal absence.

Direct Google Places collection uses the server-side `GOOGLE_PLACES_API_KEY`. The custom CRM-license-reference requirement has been removed. Radius is not applied by the Google text-search adapter; queries use business type and location text and do not guarantee complete coverage. LinkedIn uses authorized imports only. No browser scraping, login automation or owner inference is implemented. [Provider research](docs/provider-research.md) records the official documentation checked during implementation.

## Configure email

Set `RESEND_API_KEY`, a verified `RESEND_FROM`, public HTTPS `APP_URL`, a random `UNSUBSCRIBE_SECRET` of at least 32 characters, and `RESEND_WEBHOOK_SECRET`. Configure Resend events to POST to `/api/webhooks/resend`. Enable the appropriate inbound domain if reply suppression is required. Inbound events match only exact sender addresses already present in that workspace's delivery ledger. Conservatively, all reported bounces stop future outreach; the app does not attempt to infer a soft/hard bounce distinction from incomplete events.

Create or re-save drafts **after** unsubscribe configuration so the exact footer appears in review. Changing the signing secret invalidates old links and requires renewed approval of affected drafts; plan key rotation before going live. For long-lived production links, extend the signer to accept a rotating key ring.

In a lead profile, a Manager/Admin records permission and jurisdiction decisions with an HTTPS evidence URL and confirms the exact published email. New/imported contacts default to unresolved. Contact availability alone never grants send permission. Approve a complete campaign as Admin, then launch as Admin/Manager. The database binds approval to the full JSON recipients and version. The worker checks the current hash, evidence state, stop flags, suppression, weekday local business hours and sending limits immediately before the provider call. An in-flight message accepted before a stop completes cannot be recalled.

The first version uses a conservative per-contact jurisdiction-reviewed flag, rather than an automated legal rules engine. The operator must supply applicable review decisions. Unresolved reviews block every outreach channel. This does not certify legal compliance.

## Discovery targeting and saved defaults

In **Settings → Discovery search defaults**, admins and managers can save a business keyword, locations, lead limit, exclusions, review bands/ranges, website preference, and coverage settings. New searches in Discover and Automation start with those defaults and allow per-run overrides. Each search snapshots its settings; subsequent edits do not change an existing scheduled search.

The default local area scan resolves each location through Google Places, then runs distance-ranked text searches across 1, 5, or 9 local areas. It checks the selected radius against returned coordinates and scans a bounded candidate pool before selecting leads. Mixed mode takes turns across low (0–20), medium (21–100), and high (101+) review counts; the thresholds are editable. Existing CRM duplicates are removed before balancing and do not consume the new-lead limit. Filters can yield fewer leads than requested. Standard Google relevance search remains available.

Use **Fewer reviews · no website listed** to find less-reviewed businesses without a published Google website field. These are prospecting signals, not verified business size, opening dates, or proof that a website does not exist. Google returns ranked, limited samples; the app cannot promise complete or unbiased coverage. Location resolution, area searches, and pagination all use the per-run request allowance (default 30, maximum 100). Retries after failures can generate additional billable provider requests. No exact dollar cap is enforced; account pricing determines charges.

Deploy both the Vercel app and **Coolify's Dockerfile.worker** after updating. Apply `20261028174727_discovery_search_settings.sql` before using the new controls; it has already been applied to Comova / lead gen and its permissions verified. Existing searches without a settings snapshot use the legacy adapter, while all newly created searches snapshot the workspace defaults.

The targeting update passed 68 automated tests, the production build, and HTTP route checks. A bounded two-request live Lahore check returned 20 businesses (10 low-, 5 medium-, 5 high-review); 13 had no website listed. This was an adapter verification, not an outreach run or a complete city survey.

## Tests and verification

```sh
npm test
npm run typecheck
npm run build
```

Tests exercise the actual migration functions and RLS in embedded PostgreSQL (PGlite), with mock Auth/Storage schemas. They verify cross-tenant visibility/mutations, direct-write denial, role escalation denial, branch preservation, exact approval invalidation, duplicate-job prevention, permission gating and emergency cancellation. Unit tests cover local-hour eligibility, follow-up suppression decisions, bounded backoff, unsafe IPs, formula-safe CSV and unsubscribe tampering. Resend adapter network tests cover exact message transport, idempotency, 429 and ambiguous/timeout outcomes.

PGlite does not validate hosted Supabase Auth, Storage, Realtime or publication behavior. The Supabase schema was subsequently applied to comova / lead gen through the connected plugin, and the public client configuration was saved locally. The supplied Auth admin login and database connection have been verified, and the account has Comova Admin membership. Live sending-provider end-to-end tests have not run. The production build is checked separately. Local browser verification has confirmed real Comova lead rows and Google profile buttons; broad responsive QA is not claimed. See [delivery status](docs/delivery-status.md) for limits.

## Important current limits

- The workspace overview/pipeline/composer loads the latest 500 leads, 500 tasks, 100 campaigns and 100 discoveries. The All leads table has server pagination beyond that bound. CSV export covers the current permitted page. Add a streamed export job and paginated pipeline/composer for larger operational datasets.
- Saved ad-hoc segments are browser-local; the three website segments are built in. Tasks persist in Supabase, but outbound reminder notifications and a complete shared segment library are not implemented.
- Live historical growth reporting and email-open analytics are not fabricated. History starts empty until real reporting data is available. Current counters and provider cost estimates are available. Actual discovery cost/coverage is retained on the discovery record.
- Website auditing is a bounded HTML reachability/HTTPS/viewport/response-time check, with only explicit published `mailto:`, `tel:` and `wa.me` links copied when unambiguous and missing. It is not a WCAG, Lighthouse, Core Web Vitals or mobile rendering audit. Requests require explicit crawling permission and block private IPs, DNS rebinding, redirects and oversized bodies. Review site permission/robots restrictions before requesting an audit.
- Email templates are an editable starter and token substitutions, not a shared template-management library. The sequence UI supports one follow-up; arbitrary multistep sequence tooling is a later extension. Editing a sequence rebuilds it and requires renewed approval.
- Automated calling reads the approved English script and accepts a press-9 opt-out; it is not a conversational AI agent. WhatsApp supports Meta-approved text body templates with optional static footers; media, headers, buttons and named parameters are blocked. Both providers require live account activation/testing. Comprehensive jurisdiction rules, provider OAuth onboarding, team invitations, reconciliation UI and reminder notifications remain future work.

The project is a working production-oriented foundation, not a claim that the entire brief is deployed or operational without configuration.

## Environment variable sources

See [the variable-by-variable setup map](docs/environment-variables.md). The Supabase URL/key and generated unsubscribe secret are already configured in this workspace; `DATABASE_URL` is now configured and verified. Email-provider credentials are still missing.

## Activate Google, WhatsApp and voice automation

Open **Automation** in the sidebar. Follow [the automation setup guide](docs/automation-setup.md) for the account settings, exact webhook URLs, consent flow and worker startup. The new migration has been applied to **comova / lead gen** through the Supabase plugin. The database connection and Comova Admin Auth login now work. No WhatsApp message, email or call has been sent. Sending-provider credentials, public HTTPS hosting and an always-on deployed worker remain activation requirements.
