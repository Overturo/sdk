# Changelog

## [Unreleased]

### Added

- `endpoints.json` declares every endpoint this client calls, proven against the source by a self-test; tests stub recorded operations from the shared API response corpus (`__tests__/support/corpus.ts`, vendored under `__tests__/fixtures/api_responses`). The never-fetched key-set URL is no longer declared. The discovery test reads a vendored copy of the shared discovery fixture when the shared corpus is not present.

### Changed

- Source comments, tests, the example adapter and this changelog describe behaviour only; planning references were removed.
- The test suite is self-contained: the authorization decision fixtures and the signed-record corpus are vendored under `__tests__/fixtures/` (the shared copies are read when the package sits next to them).
- Repository, homepage, and issue-tracker metadata point at the public source mirror under https://github.com/overturo; a LICENSE file now ships with the package.

## [1.3.0] - 2026-08-15


### Added — pre-flight disclosure discovery (`@overturo/sdk/decisions`)

- **`discoverFlowDisclosures(http, { baseUrl, flowId, publishableKey, locale? })`**
  — the first concrete member of the decisions subpackage (the placeholder is
  retired). Fetches what a consent flow would ask a person (purposes, fields,
  steps, the action label, expiry, application branding) BEFORE any session
  exists. The publishable key is an embed-safe, per-application credential passed
  explicitly (this endpoint ignores the client's bearer token). An unknown /
  foreign / non-consent flow answers a uniform 404.
- **`FlowDisclosures`** and its member types are exported. This server client does
  not transform keys, so the type mirrors the snake_case wire verbatim.
- `HttpClient#get` — a public GET with extra headers, mirroring `post`.
- Cross-language parity is gated by the shared corpus at
  `lib/sdk/shared/conformance/discovery/flow_disclosures.json`.

## [1.2.0] - 2026-08-06


### Added — authority record client methods (`@overturo/sdk/receipts`)

- **`OverturoReceipts`** — `retrieveAuthorizationReceipt(id, {flavor})`
  (the durable record, `audit:verify` scope; canonical/signed/dpv),
  `retrieveSignedAuthorizationReceiptRaw(id)` (the raw-text exactness
  path for `@overturo/verify`'s `verifyRecord`), and
  `createDisclosureReceipt(...)` (the operator-declared disclosure
  mint, `disclosures:write` scope). Typed refusals surface as
  `OverturoValidationError` with the machine code in `reasonCode`.

### Fixed

- `@types/node` joined devDependencies — the Typecheck step failed in
  CI (`TS2688`) because the tsconfig declared `"types": ["node"]` while
  the package's own install carried no node types (it only passed
  locally by leaking the repo root's).

## [1.1.0] - 2026-06-26


### Added — cross-border

- **Jurisdiction-bound authorization.** `authorize()` accepts an optional
  `jurisdiction` (an ISO country) declaring where the action is headed. A
  request without it is unconstrained. When the platform refuses an
  out-of-bound action, the denial arrives as an `OapError` whose
  `failed_bound` is `"jurisdiction_bounds"` (reason code
  `jurisdiction_not_permitted`) — **distinct** from a transport-level refusal
  ("not allowed in that country" vs "reached the wrong place").
- **Cross-border credential verification** — `verifyReceiptOffline` accepts a
  per-issuer key set (`issuerJwks`) and verifies a presented credential against
  its issuer's own published key, with no callback.

### Compatibility

- Additive, no break. `jurisdiction` / `issuerJwks` are optional; existing
  callers are unaffected. Minor bump (1.0.0 → 1.1.0). First changelog.
