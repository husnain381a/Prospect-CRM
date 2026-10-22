# Delivery status: official Google Places only

OpenStreetMap, Overpass and Photon have been removed from the application's selectable sources and runtime networking. New discovery requests accept only official Google Places. Comova's default provider is Google. The Supabase removal migration cancels pending retired-source jobs without converting them into paid requests; historical records and schema migration history are retained. Unused internal cache tables remain inaccessible to clients.

Email remains the default composer/outreach channel. WhatsApp and calling remain implemented and explicitly paused with their activation flags set false. Database connectivity, Comova Admin sign-in and worker startup were verified previously; the validation worker is not a permanent hosted service.

**46 automated tests pass**, including official-only provider validation, source-setting tenant/role isolation, retired-job cancellation without paid conversion, email-only activation, approval/version binding, RLS, consent and webhook protections. TypeScript, production build and built-server HTTP smoke checks are also performed. No visual browser QA is claimed. A live call through the actual Google discovery adapter returned a business record using the API key alone; no test lead was saved. The local web app and worker have been started, and a fresh database heartbeat confirms worker polling.

The server Google API key is configured. Discovery no longer requires the custom CRM-license-reference setting; both API readiness and worker collection use the key alone. Email requires the Resend sending/webhook settings. No real outreach was sent during this update.

Supabase retains 14 RLS-protected tables. Its existing advisories remain: 18 intentionally role-checked authenticated security-definer RPCs and disabled leaked-password protection. The new removal does not claim those advisories are cleared.

See [Google Places setup](google-places.md), [environment variables](environment-variables.md) and [deployment](deployment.md).

The action origin check uses the incoming Host (including port) as well as the configured public URL, so browsers using localhost or 127.0.0.1 are not rejected when Next uses an internal listen address. Regression tests cover this mismatch and reject unrelated sites, wrong ports, malformed origins and untrusted forwarded-host values. Built-server HTTP checks verify both same-origin acceptance and cross-origin rejection.

Lead rows now show **Google profile** directly below each Google business name, and the same button appears in business details. Other linked sources show **View profile**. The saved Google leads have original profile URLs available. It opens the saved Google Maps business profile in a new tab with opener isolation; missing or non-HTTP source URLs are not linked. TypeScript, production build and built-server HTTP checks pass.

The application no longer includes a demo workspace, sample dataset, browser-only mutations or reset-demo controls. Server-rendered pages and first client renders show an accessible loading state, then the authenticated workspace or sign-in/setup/error screen. Old browser sample storage is removed without being loaded. Signing out clears loaded workspace data; stale in-flight responses cannot restore it. Sample records live only in isolated test fixtures. HTTP regression checks cover all nine application routes for sample-data flashes.

Browser verification confirmed reload → loading → Comova’s 15 real leads, settings without demo reset, sign-out → sign-in screen, and successful sign-in back to Comova. The currently served application bundles contain no sample dataset or account labels. Ten obsolete generated demo chunks were removed, and the local worker was restored after the earlier environment reset.
