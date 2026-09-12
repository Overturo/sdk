> **Release mirror.** This repository is a read-only snapshot of
> `@overturo/sdk` 1.3.0, published from Overturo's main
> development repository. Issues and pull requests are welcome here; accepted
> changes are ported upstream and appear in the next release snapshot.
> Security reports: see [SECURITY.md](./SECURITY.md).

# @overturo/sdk

Node SDK for [Overturo](https://overturo.com) — the trust conductor.

## Install

    npm install @overturo/sdk

## Quickstart

```ts
import { OverturoAuthorize, OverturoOversight, OapApprovalRequired } from "@overturo/sdk"
import * as decisions from "@overturo/sdk/decisions"
```

Subpath entry points:

- `@overturo/sdk` — flat re-exports of every public symbol
- `@overturo/sdk/authorize` — relying-party SDK (OAP v1.0 authorize + verify)
- `@overturo/sdk/oversight` — issuer / attester SDK (Oversight Mode)
- `@overturo/sdk/decisions` — needs-approval URL minting + long-poll subscription
- `@overturo/sdk/receipts` — authority record client methods (durable Authorization Receipts + disclosure mint)

## Authority records

The durable **Authorization Receipt** is a different artifact from the short-lived runtime receipt `authorize()` returns — the runtime receipt's TTL bounds *honoring*, not evidence, while the durable record is the archival, offline-verifiable account of the authorization.

```ts
import { OverturoReceipts } from "@overturo/sdk/receipts"

const receipts = new OverturoReceipts({ baseUrl: "https://overturo.us", apiToken: process.env.OVERTURO_API_TOKEN! })

// The durable record (audit:verify scope). Flavors: canonical (default), signed, dpv.
const record = await receipts.retrieveAuthorizationReceipt("acc_...")

// For verification, fetch the signed flavor as RAW text and hand it to
// @overturo/verify's verifyRecord — JSON.parse collapses number lexemes,
// so the raw path is the exact one.
const raw = await receipts.retrieveSignedAuthorizationReceiptRaw("acc_...")

// Mint an operator-declared disclosure receipt (disclosures:write scope).
const minted = await receipts.createDisclosureReceipt({
  flowId: "acc_...", agentId: "agt_...", disclosedAt: new Date().toISOString(),
})
```

Typed refusals reject with `OverturoValidationError` carrying the machine code in `reasonCode` (`unknown_flavor`, `not_signable`, `dpv_unavailable`; `agent_not_disclosed`, `invalid_disclosed_at`, `purposes_missing`). The 404 contract is parity-preserving: unknown, foreign, and non-authority ids are indistinguishable. An authorization-kind record is refused by the consent-receipts read with a typed hint — authority records are served only by these endpoints. Field semantics and verification: the Receipt Interop & Verification guide in the developer documentation.

## Contract and testing

This client is written against Overturo's published OpenAPI document, kept at
<https://github.com/overturo/openapi>. When the client and the API disagree, the
document is the authority; a change to it is a change to this client.

The test suite stubs recorded operations from the shared API response corpus
(<https://github.com/overturo/conformance>, `api_responses/`), vendored under
`__tests__/fixtures/api_responses`. Each recording was made against the real API and checked against
the published document before it was committed, so a passing suite means the
client parses what the API actually sends — not what a test author remembered.
Identifiers, timestamps and tokens in the recordings are placeholders
(`<PREFIX_ID:1>`, `2026-01-01T00:00:00Z`, `<TOKEN>`); the corpus README documents the
grammar.

Run the suite with `npm test`. When you add a test for a recorded operation, stub it
from the recording (`corpusResponse("AuthorizationReceipts_show")`) rather than writing the response by hand.

## License

Apache-2.0
