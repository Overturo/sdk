/**
 * Wire-level integration suite for @overturo/sdk.
 *
 * Boots no servers — assumes an Overturo instance is reachable at $BASE_URL
 * (default http://localhost:5000) with the OAP feature flag enabled.
 * If the server is unreachable every test skips, so the suite is safe
 * to include in the default Vitest run.
 *
 * This is the harness whose absence allowed the DPoP `ath` bug to ship
 * in Sprint 4 — every test exercises the real wire format end-to-end.
 */

import { beforeAll, describe, expect, it } from "vitest"
import { randomUUID } from "node:crypto"
import { OverturoAuthorize, verifyReceiptOffline } from "../../src/index.js"
import { peekReceipt, rawEd25519ToJwk } from "../../src/index.js"
import { OapError, isOapError } from "../../src/index.js"
import type { JwksKey } from "../../src/index.js"
import { loadOapScenario, type IntegrationFixture } from "./scenario.js"

let fixture: IntegrationFixture | null = null
let jwks: JwksKey[] = []

beforeAll(async () => {
  fixture = await loadOapScenario()
  if (fixture === null) return

  const jwksUrl = `${fixture.baseUrl}/.well-known/jwks.json`
  const res = await fetch(jwksUrl)
  if (!res.ok) {
    throw new Error(`JWKS fetch failed: ${res.status}`)
  }
  const body = (await res.json()) as { keys: Array<{ kid: string; x: string }> }
  jwks = body.keys.map((k) => rawEd25519ToJwk(k.kid, k.x))
})

function skipIfNoServer(): void {
  if (fixture === null) {
    // eslint-disable-next-line no-console
    console.warn("[oap integration] skipping — no Rails server at BASE_URL. Run `bin/dev` and re-run.")
  }
}

describe.skipIf(() => fixture === null)("OAP wire integration", () => {
  it("seed contract carries all the fields the SDK needs", () => {
    skipIfNoServer()
    if (!fixture) return
    const { contract } = fixture
    expect(contract.grant.prefix_id).toMatch(/^ath_/)
    expect(contract.counterparty.bearer_token).toMatch(/^cpt_/)
    expect(contract.agent_token.split(".").length).toBe(3)
    expect(contract.iss).toMatch(/^https?:/)
    expect(contract.api_base_url).toMatch(/^https?:/)
    expect(contract.dpop.private_seed_b64url).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it("authorize() round-trips against a live server (proves the DPoP ath fix)", async () => {
    if (!fixture) return
    const { contract, dpopKey } = fixture
    const client = new OverturoAuthorize({
      grantId: contract.grant.prefix_id,
      agentToken: contract.agent_token,
      dpopKey,
      iss: contract.iss,
      apiBaseUrl: contract.api_base_url,
    })

    const result = await client.authorize({
      nonce: randomUUID(),
      action: "read",
      scope: "profile",
    })

    expect(result.decision).toBe("allow")
    if (result.decision !== "allow") return
    expect(result.receipt).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(result.jti).toBeTruthy()
    expect(result.chronicle_id).toMatch(/^audit_rec_/)
  })

  it("receipts verify offline against the live JWKS", async () => {
    if (!fixture) return
    const { contract, dpopKey } = fixture
    const client = new OverturoAuthorize({
      grantId: contract.grant.prefix_id,
      agentToken: contract.agent_token,
      dpopKey,
      iss: contract.iss,
      apiBaseUrl: contract.api_base_url,
    })

    const result = await client.authorize({
      nonce: randomUUID(),
      action: "read",
      scope: "profile",
      counterparty: contract.counterparty.identifier,
    })
    if (result.decision !== "allow") throw new Error("expected allow")

    const verified = await verifyReceiptOffline(result.receipt, {
      audience: contract.counterparty.identifier,
      acceptedIssuers: [contract.iss],
      jwks,
    })
    expect(verified.valid).toBe(true)
    expect(verified.claims?.grant_id).toBe(contract.grant.prefix_id)
    expect(verified.claims?.action).toBe("read")
  })

  it("scope_not_covered surfaces as a typed OapError", async () => {
    if (!fixture) return
    const { contract, dpopKey } = fixture
    const client = new OverturoAuthorize({
      grantId: contract.grant.prefix_id,
      agentToken: contract.agent_token,
      dpopKey,
      iss: contract.iss,
      apiBaseUrl: contract.api_base_url,
    })

    let caught: unknown
    try {
      await client.authorize({
        nonce: randomUUID(),
        action: "read",
        scope: "admin", // grant only allows profile + email
      })
    } catch (e) {
      caught = e
    }
    expect(isOapError(caught)).toBe(true)
    expect((caught as OapError).reason_code).toBe("scope_not_covered")
    expect((caught as OapError).http_status).toBe
  })

  it("action_not_allowed surfaces as a typed OapError", async () => {
    if (!fixture) return
    const { contract, dpopKey } = fixture
    const client = new OverturoAuthorize({
      grantId: contract.grant.prefix_id,
      agentToken: contract.agent_token,
      dpopKey,
      iss: contract.iss,
      apiBaseUrl: contract.api_base_url,
    })

    let caught: unknown
    try {
      await client.authorize({
        nonce: randomUUID(),
        action: "delete", // grant denies delete
        scope: "profile",
      })
    } catch (e) {
      caught = e
    }
    expect(isOapError(caught)).toBe(true)
    expect((caught as OapError).reason_code).toBe("action_not_allowed")
  })

  it("nonce replay is rejected", async () => {
    if (!fixture) return
    const { contract, dpopKey } = fixture
    const client = new OverturoAuthorize({
      grantId: contract.grant.prefix_id,
      agentToken: contract.agent_token,
      dpopKey,
      iss: contract.iss,
      apiBaseUrl: contract.api_base_url,
    })

    const nonce = randomUUID()
    const first = await client.authorize({ nonce, action: "read", scope: "profile" })
    expect(first.decision).toBe("allow")

    let caught: unknown
    try {
      await client.authorize({ nonce, action: "read", scope: "profile" })
    } catch (e) {
      caught = e
    }
    expect(isOapError(caught)).toBe(true)
    expect((caught as OapError).reason_code).toBe("nonce_replay")
  })

  it("decode endpoint accepts the receipt anonymously", async () => {
    if (!fixture) return
    const { contract, dpopKey } = fixture
    const client = new OverturoAuthorize({
      grantId: contract.grant.prefix_id,
      agentToken: contract.agent_token,
      dpopKey,
      iss: contract.iss,
      apiBaseUrl: contract.api_base_url,
    })
    const result = await client.authorize({
      nonce: randomUUID(),
      action: "read",
      scope: "profile",
    })
    if (result.decision !== "allow") throw new Error("expected allow")

    const decoded = await fetch(`${fixture.baseUrl}/.well-known/overturo-decode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receipt: result.receipt }),
    }).then((r) => r.json())

    expect(decoded.structurally_valid).toBe(true)
    expect(decoded.signature_valid).toBe(true)
    expect(decoded.claims_preview.jti).toBe(result.jti)
  })

  it("peekReceipt locally matches the server's decode", async () => {
    if (!fixture) return
    const { contract, dpopKey } = fixture
    const client = new OverturoAuthorize({
      grantId: contract.grant.prefix_id,
      agentToken: contract.agent_token,
      dpopKey,
      iss: contract.iss,
      apiBaseUrl: contract.api_base_url,
    })
    const result = await client.authorize({
      nonce: randomUUID(),
      action: "read",
      scope: "profile",
    })
    if (result.decision !== "allow") throw new Error("expected allow")

    const peeked = peekReceipt(result.receipt)
    expect(peeked).not.toBeNull()
    expect(peeked!.claims.iss).toBe(contract.iss)
    expect(peeked!.claims.grant_id).toBe(contract.grant.prefix_id)
    expect(peeked!.header.typ).toBe("oap+jwt")
  })
})
