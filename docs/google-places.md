# Official Google Places setup

OpenStreetMap has been removed. Discover and Automation now show **Official Google Places** with no free-source switch. Comova's saved default has been changed to Google. Old open-source searches are cancelled; create a fresh Google search when ready.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select/create your project.
2. Enable billing and **Places API (New)**. Create a server API key under APIs & Services -> Credentials and restrict it to the API and your deployment where supported. Follow [Google's setup documentation](https://developers.google.com/maps/documentation/places/web-service/get-api-key).
3. Set `GOOGLE_PLACES_API_KEY` in the ignored `.env.local` and on both hosted services. Do not use a `NEXT_PUBLIC_` key variable.
4. No custom CRM-license-reference setting is required. Discovery readiness checks the server API key. Keep source attribution and review the [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies) for your deployment and data handling.
5. Set `GOOGLE_PLACES_REQUEST_COST` to your estimate for the requested fields/SKU. Export and Google-sourced voice-use rights remain separate default-off flags. Displayed estimates are not Google billing caps; configure quotas/alerts in Google Cloud.
6. Restart the web app and worker. Locally run `npm run dev` and `npm run worker` in separate terminals. Public hosting requires the same server settings and a separate always-on worker.
7. Sign in to Comova, open Discover, and create a small one-time search by business type and city/country. The adapter uses Text Search (New), paginates results, and deduplicates source identities. It does not guarantee complete business coverage.

Google can return business names, addresses, published phones, websites, ratings/review counts and source links. It does not supply this app with guessed owner emails. Optional authorized website enrichment copies explicit published contact links; email verification/permission and exact-version Admin approval are still required before sending.

Email is the current outreach workflow. Its Resend credentials and public HTTPS callback/unsubscribe setup remain necessary for actual delivery. WhatsApp and calling remain implemented but paused with `WHATSAPP_ENABLED=false` and `AUTOMATED_CALLS_ENABLED=false`.

The replacement API key has passed a live Text Search API check. The setup screen reports whether a key is configured; worker availability and Google account access are separate runtime checks.
