# Activate automation

The **Automation** sidebar page now connects collection, channel consent, message preparation, approvals, delivery and recent worker activity. The automation database migration is installed in **comova -> lead gen**. External accounts and hosting are not provisioned by source code.

## 1. Database, login and worker

Open [the Supabase project](https://supabase.com/dashboard/project/lmxipkioiccpbllbocgt). The public project URL/key are already in the ignored local `.env.local`. The supplied admin user now has Comova Admin membership, and sign-in has been verified. No password was embedded in source files or environment examples.

The user-provided `DATABASE_URL` has been connection-tested. For another installation, copy **Connect -> Session pooler** into `DATABASE_URL`, with the database password substituted and URL-encoded. Set it on both the web service and worker. The database password differs from your Supabase login and CRM user passwords.

Run `npm run dev` for local exploration and `npm run worker` in a second terminal for durable background work. For public callbacks deploy the web service to an HTTPS domain, set `APP_URL` to its exact origin, and run the worker as a separate always-on Node service. Restart both services after environment changes. Never commit `.env.local`.

## 2. Google collection

In [Google Cloud Console](https://console.cloud.google.com/), enable billing and **Places API (New)** for your project. Create a server API key under APIs & Services -> Credentials, restrict its API access, and set `GOOGLE_PLACES_API_KEY` on the web and worker.

The connector makes real Text Search (New) requests with keyword + location, paginates each location and saves deduplicated source records. It collects available business name, address, category, website, published phone, rating/review count, source link and timezone. It does not invent an email, owner identity, WhatsApp availability or consent. Missing timezone blocks outreach until a manager records a valid IANA timezone in the channel permission form. Ranked search results are partial coverage; radius filtering is not implemented in this adapter.

The custom CRM-license-reference blocker has been removed. Collection readiness requires `GOOGLE_PLACES_API_KEY`; no additional Google-issued credential is needed. Source attribution is preserved. Export and Google-sourced voice-use flags remain separate and default off.

Set `GOOGLE_PLACES_REQUEST_COST` to your estimated per-request cost for the chosen fields/SKU. Configure quotas/billing alerts in Google Cloud; the displayed estimate is not an enforceable Google billing cap. See [Google Maps terms](https://cloud.google.com/maps-platform/terms), [Places Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search), and [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies).

In Automation -> Collect leads, choose Google, enter locations and a limit, and select once/daily/weekly. Optional website enrichment requires the explicit crawling authorization checkbox. The separate worker runs searches, stores page checkpoints, deduplicates and schedules the next run. The existing Discover view shows progress and provides cancellation.

## 3. WhatsApp

In [Meta for Developers](https://developers.facebook.com/apps/), set up your business app, WhatsApp Business Account and production sending number. Configure these on both services:

- `WHATSAPP_ACCESS_TOKEN`: production token with the required messaging/template-management permissions for that business account.
- `WHATSAPP_PHONE_NUMBER_ID`: ID of the sending number, not its E.164 address.
- `WHATSAPP_BUSINESS_ACCOUNT_ID`: owning business account ID.
- `META_GRAPH_VERSION`: a currently supported version for your app, in `vXX.X` format.
- `META_APP_SECRET`: app secret for raw-body signature verification.
- `META_VERIFY_TOKEN`: your own random verification value.

Configure the Meta WhatsApp webhook callback to `https://YOUR_DOMAIN/api/webhooks/whatsapp`, enter the same verification token and subscribe the app to the account's **messages** events. The GET challenge and signed POST receiver are implemented. Only configured account/phone-ID events are processed.

Create and obtain Meta approval for a **text BODY template**, optionally with a static FOOTER. It must explain opt-out, for example replying STOP. This version intentionally rejects headers, media, buttons and named parameters. In Automation, load the actual approved templates from Meta and enter numbered body parameters in order. `{{business}}` and `{{city}}` can personalize parameter values from CRM facts. The saved rendered message and template fingerprint are bound to the campaign version; the worker checks current Meta template approval/content again before sending.

Record the recipient's verified WhatsApp address, explicit opt-in, evidence URL and jurisdiction decision in Automation. A published phone number alone is insufficient. Save a draft, inspect every saved recipient/body/schedule/cost, approve as Admin, then launch. The worker sends approved templates automatically at the scheduled time, subject to local business hours and limits. Signed incoming replies/STOP messages stop future outreach for the lead. See [WhatsApp business messaging policy](https://business.whatsapp.com/policy).

## 4. Automated calling

In [Twilio Console](https://console.twilio.com/), obtain `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`. Add a voice-capable number owned by the account as `TWILIO_FROM` in E.164 format. Enable the intended destinations and account capabilities. Trial accounts and destination restrictions can prevent calls even with valid credentials.

Record explicit consent for **automated** calls, the verified destination phone, jurisdiction decision and evidence URL. Compose your business identity and exact script in Automation. The reviewed body includes an automation disclosure and a press-9 opt-out instruction. Calls use English text-to-speech, a maximum 60 seconds in the UI, and no recording. They do not hold an AI conversation, qualify leads through speech, or transfer to a salesperson.

Save the draft and review every script and recipient. As Admin, first choose **Approve automated calls**, then **Approve campaign**. Launch as Admin/Manager. Any edit invalidates both approvals. The worker submits scheduled Twilio calls with application-controlled instructions at `/api/voice` and status callbacks at `/api/webhooks/twilio`; those URLs are included in the API request automatically. Both endpoints verify Twilio signatures and the configured account. Keep them publicly reachable over HTTPS. Your reverse proxy must preserve their path/query string, and `APP_URL` must match the public origin.

The voice endpoint rechecks approval, permissions and stops before playing the script. Pressing 9 suppresses the lead and cancels queued outreach. Twilio status events update the delivery ledger; sequence numbers prevent an older event from regressing a call's status. See [Twilio Calls API](https://www.twilio.com/docs/voice/api/call-resource) and [webhook security](https://www.twilio.com/docs/usage/security).

## 5. Verify with accounts you control

Use approved internal recipients to verify provider account access, template delivery, voice playback, press-9, replies, stops and signed status events. Database access and admin sign-in have been verified. A bounded free-source probe resolved/cached its location but timed out when querying the public Overpass service; complete live collection remains unverified. No real emails, WhatsApp messages or calls were sent. Sending-provider secrets remain absent. Automated local tests mock provider networking and execute the approval/event SQL in embedded PostgreSQL; they cannot certify your provider account or public deployment.

Automation displays the latest 50 jobs and safe error details. Unknown provider outcomes remain **uncertain** to avoid duplicate outreach. Do not simply requeue them; reconcile against provider logs, or allow a late signed correlated callback to resolve the job. See [the operations guide](operations.md).

New recipients and changed content retain the original brief's exact-version Admin approval requirement. After approval and launch, scheduling, local-hour checks, retries, sending, callback processing and suppression run without further per-message clicks.

## Current official-only discovery and email mode

The free-source option has been removed. Use [Google Places setup](google-places.md) for official discovery. Both `WHATSAPP_ENABLED` and `AUTOMATED_CALLS_ENABLED` remain `false`. Later activation requires the relevant flag, provider credentials, consent and approval setup. Paused advanced jobs are deferred, not deleted.
