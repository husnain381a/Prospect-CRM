# Licensed provider adapter contract

`POST LICENSED_DISCOVERY_URL`, HTTPS only, with `Authorization: Bearer LICENSED_DISCOVERY_TOKEN`.

Request:

```json
{"keyword":"Dental clinics","locations":["Austin, Texas, US","Denver, Colorado, US"],"radius":25,"limit":50,"exclusions":["excluded.example"],"cursor":"opaque-optional-cursor"}
```

Response:

```json
{
  "records":[{"name":"Authorized Business","category":"Dental clinic","address":"1 Main Street","city":"Austin","country":"US","timezone":"America/Chicago","website":"https://business.example","email":"public@business.example","phone":"+15125550100","rating":4.7,"reviews":25,"source_id":"licensed-123","source_url":"https://provider.example/business/licensed-123"}],
  "nextCursor":"opaque-next-cursor-or-omit",
  "cost":0.01,
  "coverage":"Sample of licensed records; some categories and branches may be absent",
  "license":{"storage":true,"export":false}
}
```

Use valid JSON numeric rating/review counts. URLs must be absolute. Country uses two characters; timezone must be an IANA identifier if outreach will be scheduled. Omit unavailable contact fields or return empty strings; never fabricate them. `nextCursor` must make forward progress. A page has at most 500 records; the worker asks for up to 100 and stops at the selected result limit or a bounded 100 pages. Each response cost is accumulated and checkpointed. Quotes in the UI are illustrative configuration estimates, not verified provider pricing.

`license.storage` must be explicitly true. The adapter propagates `license.export` to records; CSV export rejects records without that permission. This response is a technical assertion that must be backed by your actual contract. Record names, websites and generic business contacts do not identify a business owner.

Records enter with unverified field provenance and unresolved outreach permission. Missing website data becomes `unverified`, never `not_found`. Source ID is the preferred deduplication key. Address plus domain, phone or business name may match a branch. Shared chain domains/switchboards alone never merge distinct addresses.

Authorized CSV imports use the same normalization/validation. Imports currently process records individually after validating the full payload; database failures can leave an imported prefix. Source IDs make retries idempotent. Source-less unknown-address rows may require manual review, because guessing identity risks collapsing distinct branches.

Google and LinkedIn adapters deliberately return setup restrictions rather than attempting unsupported collection. Add a new adapter by implementing `DiscoveryAdapter` and selecting it explicitly in the worker after licensing, rate limits, checkpoint behavior and provenance are tested.
