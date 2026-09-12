/**
 * Test helper: load the OAP journey scenario from the running Rails
 * server and reconstruct the typed contract the SDK suite consumes.
 *
 * Requires a Rails server reachable at $BASE_URL (default
 * http://localhost:5000) with the OAP feature flag enabled. Tests that
 * use this helper auto-skip when the server is unreachable, so the
 * harness is safe to run in environments where Rails isn't up (e.g.
 * the JS SDK CI lane that doesn't boot Rails).
 */

import { webcrypto } from "node:crypto"
import type { DpopKeyPair } from "../../src/authorize/dpop.js"

const BASE_URL = process.env.BASE_URL || "http://localhost:5000"
const SCENARIO_NAME = "journeys/oap_agent_workflow"

export interface OapAgentWorkflowContract {
  principal: { email: string; password: string; prefix_id: string }
  account_id: number
  touchpoint: { prefix_id: string; name: string }
  grant: {
    prefix_id: string
    region: string
    scope: string[]
    actions: string[]
    valid_until: string
  }
  counterparty: { prefix_id: string; identifier: string; bearer_token: string }
  dpop: { private_seed_b64url: string; jkt: string }
  agent_token: string
  iss: string
  api_base_url: string
}

export interface IntegrationFixture {
  baseUrl: string
  contract: OapAgentWorkflowContract
  dpopKey: DpopKeyPair
}

/**
 * Seed the journey scenario and reconstruct the matching DPoP keypair.
 * Returns null when the Overturo server is unreachable so callers can skip
 * gracefully.
 */
export async function loadOapScenario(): Promise<IntegrationFixture | null> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}/internal/scenarios/seed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Scenario-Engine": "true",
      },
      body: JSON.stringify({ scenario: SCENARIO_NAME }),
    })
  } catch (e) {
    // ECONNREFUSED / DNS failure → server isn't running. Bail out.
    return null
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Scenario seed failed (${response.status}): ${text.slice(0, 200)}`)
  }

  const payload = (await response.json()) as { data: OapAgentWorkflowContract }
  const contract = payload.data

  const dpopKey = await rebuildDpopKey(contract.dpop.private_seed_b64url)
  return { baseUrl: BASE_URL, contract, dpopKey }
}

/**
 * Rebuild the Ed25519 DPoP keypair from the raw 32-byte seed the
 * scenario emits. Web Crypto's `importKey` for "raw" Ed25519 takes the
 * private key seed; the public key derives automatically.
 */
async function rebuildDpopKey(seedB64Url: string): Promise<DpopKeyPair> {
  const seed = base64urlToBytes(seedB64Url)
  if (seed.length !== 32) {
    throw new Error(`OAP scenario emitted a non-Ed25519 seed (got ${seed.length} bytes)`)
  }

  // PKCS#8 wrapper around the 32-byte seed — Node's Web Crypto only
  // accepts Ed25519 private keys in pkcs8 format. The 16-byte ASN.1
  // header below is the constant pkcs8 prefix for Ed25519.
  const pkcs8 = new Uint8Array(seed.length + 16)
  pkcs8.set([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20], 0)
  pkcs8.set(seed, 16)

  const privateKey = await webcrypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"])

  // Derive the public JWK by importing the raw public key — Web Crypto
  // doesn't expose `derivePublicKey` for Ed25519, so we use the raw
  // public-key bytes the scenario also persists on the grant. To get
  // them locally we sign a known input then leverage `verify` for
  // round-trip; but the easier path: importKey the seed as pkcs8 with
  // `extractable: true` and exportKey jwk — exportKey emits both `d`
  // (private) and `x` (public).
  const jwk = (await webcrypto.subtle.exportKey("jwk", privateKey)) as {
    x: string
  }

  return {
    privateKey,
    publicJwk: { kty: "OKP", crv: "Ed25519", x: jwk.x },
  }
}

function base64urlToBytes(b64url: string): Uint8Array {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4)
  const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/")
  return new Uint8Array(Buffer.from(b64, "base64"))
}
