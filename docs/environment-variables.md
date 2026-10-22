# Where every environment variable comes from

The live target is **comova → lead gen** in Supabase. The project URL and publishable key have already been written to `.env.local`, and a random unsubscribe secret has been generated locally. Secret values are deliberately excluded from the source ZIP.

Use the `.env.local` file in the same directory as `package.json`. Restart the Next.js server and worker after changing it. For hosting, enter the corresponding values in each service's environment settings. Public Supabase variables must be present when the frontend is built.

## Database and login

Open [your Supabase project](https://supabase.com/dashboard/project/lmxipkioiccpbllbocgt).

| Variable | Where to get it | Current need |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | The project's **Connect** panel / project API configuration. This project's URL is `https://lmxipkioiccpbllbocgt.supabase.co`. | Already configured. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project **Settings → API Keys → Publishable key** (`sb_publishable_...`). | Already configured. |
| `DATABASE_URL` | Click **Connect → Session pooler** and copy the PostgreSQL connection string. Replace `[YOUR-PASSWORD]` with the **database password** selected when the project was created. URL-encode special characters in that password. | Configured and connection-tested. Used by the worker and verified webhook/unsubscribe handlers. It is different from your Supabase dashboard login password and any CRM user's password. |
| `SUPABASE_SECRET_KEY` | Project **Settings → API Keys → Secret key** (`sb_secret_...`). | **Leave blank for the current application.** This is reserved and unused. Do not fetch a powerful credential unless a server feature actually needs it. |

References: [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys) and [Postgres connection strings](https://supabase.com/docs/guides/database/connecting-to-postgres).

The CRM database tables, security policies, private storage bucket and scoring functions have been applied to this project. The supplied admin account is now confirmed, assigned to Comova as Admin, and its password sign-in has been verified. There is no `ADMIN_PASSWORD` or similar environment variable: create users through **Authentication → Users → Add user**, using an email/password you control. Then grant workspace membership as described in the README. A Supabase project/organization administrator is not automatically a CRM workspace Admin. Never put user passwords or roles in `NEXT_PUBLIC_*` variables.

## Application-owned settings

| Variable | Value / source |
| --- | --- |
| `APP_URL` | Your app's origin. For local use, `http://localhost:3000`; after deployment, your real HTTPS domain, for example `https://crm.yourdomain.com`. This is the frontend URL, not the Supabase URL. |
| `UNSUBSCRIBE_SECRET` | A random secret generated locally. **Already generated in `.env.local`.** If setting up a separate installation, run `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and save the result. Keep it stable so existing signed unsubscribe links continue working. |
| `WORKER_CONCURRENCY` | Your setting; keep `2` initially. |
| `WORKER_POLL_MS` | Your setting in milliseconds; keep `2500` initially. |

## Email through Resend

Create/use your [Resend account](https://resend.com/). These values are separate from Supabase Auth email/SMTP settings.

| Variable | Where to get it |
| --- | --- |
| `RESEND_API_KEY` | [Resend → API Keys](https://resend.com/api-keys) → create a key with the sending permissions your deployment needs (`re_...`). |
| `RESEND_FROM` | A sender on a domain you have added and verified in [Resend → Domains](https://resend.com/domains), for example `Comova <hello@yourdomain.com>`. Do not copy this example literally unless you own and verify the domain. |
| `RESEND_WEBHOOK_SECRET` | [Resend → Webhooks](https://resend.com/webhooks) → add your endpoint `https://YOUR_APP_DOMAIN/api/webhooks/resend` → copy its **Signing Secret** (`whsec_...`). This is not the API key. The endpoint must be reachable by Resend. |

References: [API keys](https://resend.com/docs/dashboard/api-keys/introduction), [verified domains](https://resend.com/docs/dashboard/domains/introduction), [webhooks](https://resend.com/docs/webhooks/introduction).

Email outreach also needs the database URL, application URL, unsubscribe secret, running worker, recorded recipient eligibility and exact-version admin approval. Filling in credentials does not by itself authorize sending. Supabase's login/confirmation/password-recovery email settings are configured separately under **Authentication → Email/SMTP**.

## Licensed business discovery

| Variable | Where to get it |
| --- | --- |
| `LICENSED_DISCOVERY_URL` | An HTTPS service endpoint implementing this app's [provider contract](provider-contract.md). |
| `LICENSED_DISCOVERY_TOKEN` | The authentication token for that same service. |

These are **custom adapter placeholders**. There is no preselected vendor you can simply obtain these from, and a random business-data API key will not work unchanged. Choose a dataset/provider whose agreement permits the intended storage/export, then implement the adapter for its API or an intermediary endpoint matching the contract. Leave them blank while using authorized CSV/manual imports. They are not Google Maps API credentials; direct Google Places collection uses its separate API key and licensing configuration below.

## WhatsApp automation configuration

The official Meta adapter is connected to the worker. Use Automation to load approved templates, record opt-in, review the exact message, approve and launch. Configure the webhook and production account before sending.

| Variable | Where to get it |
| --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | [Meta for Developers](https://developers.facebook.com/apps/) → your business app → WhatsApp API setup. Use an appropriately scoped production/system-user token for a production integration. |
| `WHATSAPP_PHONE_NUMBER_ID` | The same app's **WhatsApp → API Setup**, alongside the sending phone number. Copy the **phone number ID**, not the phone number itself. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | The WhatsApp Business Account ID shown in Meta WhatsApp API Setup / WhatsApp Manager. This identifies the account owning your templates and webhook events. |
| `META_APP_SECRET` | The Meta app's **Settings → Basic → App Secret**. Used to verify raw-body Meta webhook signatures. |
| `META_VERIFY_TOKEN` | A random value you generate and later enter identically in your Meta webhook verification configuration. Use it when verifying `/api/webhooks/whatsapp`. |
| `META_GRAPH_VERSION` | A supported Graph API version selected for your app/integration, in the format `vXX.X`. Verify the version against current Meta documentation before enabling the adapter. |

## Automated calling configuration

Twilio calling is connected to the durable worker. Calls require explicit automated calling consent, exact script review and separate Admin calling approval. Existing click-to-call links still use the device phone handler.

| Variable | Where to get it |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | [Twilio Console](https://console.twilio.com/) → account/project dashboard → **Account SID** (`AC...`). |
| `TWILIO_AUTH_TOKEN` | The same account's **Auth Token**. Keep it server-only. |
| `TWILIO_FROM` | A voice-capable phone number assigned to your Twilio account under **Phone Numbers → Active Numbers**, in E.164 format (`+` followed by country code and number). |

Reference: [Twilio API authentication](https://www.twilio.com/docs/usage/requests-to-twilio).

## Smallest setup to start

1. Supabase URL/key: already configured in this workspace.
2. Sign in with the supplied admin account; Comova Admin membership is already provisioned.
3. `DATABASE_URL` is configured and verified; run `npm run worker` for background processing.
4. Add Resend settings only when you want to configure approved email outreach.
5. Configure Google / Meta / Twilio using the automation guide, publish the HTTPS webhook endpoints, and run approved internal recipient tests before operational use.

Use `.env.local` or your hosting secret manager for secret values. Do not paste database passwords, API secrets or `.env.local` contents into a public repository or chat. The only browser-public variables here are the two beginning with `NEXT_PUBLIC_`.

## Direct Google collection

| Variable | Where to get it |
| --- | --- |
| `GOOGLE_PLACES_API_KEY` | Google Cloud Console: select your project, enable Places API (New) and billing, then APIs & Services -> Credentials -> API key. Restrict the key to the Places API and your server deployment where supported. |
| `GOOGLE_PLACES_EXPORT_ALLOWED` | Your license decision: `true` only when export is explicitly permitted; otherwise `false`. |
| `GOOGLE_PLACES_VOICE_LICENSE_ALLOWED` | Your license decision: `true` only when Google-sourced content may be used with text-to-speech. Standard Google Maps terms restrict this. Otherwise Google-sourced lead calls are blocked. |
| `GOOGLE_PLACES_REQUEST_COST` | Your estimated USD cost per search request for the selected fields/SKU and contract. This is an estimate, not a Google billing cap. Configure provider quotas/budgets separately. |

Detailed activation steps and webhook URLs: [automation setup](automation-setup.md).

## Official-only discovery and staged channels

OpenStreetMap has been removed. No `OSM_*` settings are used. Follow [Google Places setup](google-places.md) for the server API key and billing/API enablement. The old custom CRM-license-reference setting is no longer used.

`WHATSAPP_ENABLED=false` and `AUTOMATED_CALLS_ENABLED=false` continue to pause retained advanced transports. Email remains enabled as a workflow; actual delivery still requires the Resend account configuration above.
