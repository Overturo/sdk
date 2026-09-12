import { describe, it, expect, beforeAll } from "vitest"
import { webcrypto } from "node:crypto"
import { bytesToBase64url } from "../../src/authorize/receipt.js"
import { verifyReceiptOffline, rawEd25519ToJwk } from "../../src/verify.js"
import type { JwksKey } from "../../src/authorize/types.js"

/**
 * Round-trip verify spec: generate an Ed25519 keypair, sign a receipt,
 * confirm `verifyReceiptOffline` accepts it, then tweak each failure
 * dimension and confirm the matching reason_code surfaces.
 */

let privateKey: CryptoKey
let jwks: JwksKey[]
const kid = "oap-test-v1"
const audience = "did:web:cp.example"
const issuer = "https://us.overturo.test"

const baseClaims = () => ({
  iss: issuer,
  aud: audience,
  iat: Math.floor(Date.now() / 1000) - 5,
  exp: Math.floor(Date.now() / 1000) + 60,
  jti: `n_${Math.random().toString(36).slice(2)}`,
  oap_ver: "1.0" as const,
  grant_id: "ath_test_xyz",
  action: "read",
  scope: "profile",
  context_hash: "0a0b0c0d0e0f00112233445566778899aabbccddeeff00112233445566778899",
  chronicle_id: "audit_rec_test_xyz",
  single_use: true as const,
})

async function sign(header: object, claims: object, key: CryptoKey = privateKey): Promise<string> {
  const enc = (obj: object) => bytesToBase64url(new TextEncoder().encode(JSON.stringify(obj)))
  const headerB64 = enc(header)
  const claimsB64 = enc(claims)
  const input = `${headerB64}.${claimsB64}`
  const sig = await webcrypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(input))
  return `${input}.${bytesToBase64url(new Uint8Array(sig))}`
}

beforeAll(async () => {
  // Node 20.18+ already exposes `globalThis.crypto === webcrypto` as a
  // non-configurable getter, so verify.ts finds the Web Crypto interface
  // without any setup here.
  const kp = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair
  privateKey = kp.privateKey
  const publicJwk = (await webcrypto.subtle.exportKey("jwk", kp.publicKey)) as { x: string }
  jwks = [rawEd25519ToJwk(kid, publicJwk.x)]
})

describe("verifyReceiptOffline", () => {
  const header = () => ({ alg: "EdDSA" as const, typ: "oap+jwt" as const, kid })

  it("accepts a freshly issued receipt", async () => {
    const jwt = await sign(header(), baseClaims())
    const r = await verifyReceiptOffline(jwt, {
      audience,
      acceptedIssuers: [issuer],
      jwks,
    })
    expect(r.valid).toBe(true)
    expect(r.reason_code).toBeUndefined()
    expect(r.claims?.jti).toBeDefined()
  })

  // resolve a presented credential against its issuer's own key.
  it("resolves the key from issuerJwks by the receipt's iss (empty global jwks)", async () => {
    const eu = "https://eu.overturo.test"
    const jwt = await sign(header(), { ...baseClaims(), iss: eu })
    const r = await verifyReceiptOffline(jwt, {
      audience,
      acceptedIssuers: [eu],
      jwks: [], // empty — success proves issuerJwks was used
      issuerJwks: { [eu]: jwks },
    })
    expect(r.valid).toBe(true)
    expect(r.claims?.iss).toBe(eu)
  })

  it("falls back to jwks when the issuer isn't in issuerJwks", async () => {
    const jwt = await sign(header(), baseClaims())
    const r = await verifyReceiptOffline(jwt, {
      audience,
      acceptedIssuers: [issuer],
      jwks,
      issuerJwks: { "https://other.test": [] },
    })
    expect(r.valid).toBe(true)
  })

  it("rejects malformed input as `malformed`", async () => {
    const r = await verifyReceiptOffline("nope", {
      audience,
      acceptedIssuers: [issuer],
      jwks,
    })
    expect(r.valid).toBe(false)
    expect(r.reason_code).toBe("malformed")
  })

  it("rejects wrong alg as `invalid_alg`", async () => {
    const jwt = await sign({ ...header(), alg: "RS256" }, baseClaims())
    const r = await verifyReceiptOffline(jwt, {
      audience,
      acceptedIssuers: [issuer],
      jwks,
    })
    expect(r.reason_code).toBe("invalid_alg")
  })

  it("rejects wrong typ as `invalid_typ`", async () => {
    const jwt = await sign({ ...header(), typ: "jwt" }, baseClaims())
    const r = await verifyReceiptOffline(jwt, {
      audience,
      acceptedIssuers: [issuer],
      jwks,
    })
    expect(r.reason_code).toBe("invalid_typ")
  })

  it("rejects an unknown kid", async () => {
    const jwt = await sign({ ...header(), kid: "oap-other-v9" }, baseClaims())
    const r = await verifyReceiptOffline(jwt, {
      audience,
      acceptedIssuers: [issuer],
      jwks,
    })
    expect(r.reason_code).toBe("unknown_kid")
  })

  it("rejects mismatching audience as `invalid_aud`", async () => {
    const jwt = await sign(header(), baseClaims())
    const r = await verifyReceiptOffline(jwt, {
      audience: "did:web:wrong.example",
      acceptedIssuers: [issuer],
      jwks,
    })
    expect(r.reason_code).toBe("invalid_aud")
    expect(r.claims).toBeDefined()
  })

  it("rejects mismatching issuer as `invalid_iss`", async () => {
    const jwt = await sign(header(), baseClaims())
    const r = await verifyReceiptOffline(jwt, {
      audience,
      acceptedIssuers: ["https://other.example"],
      jwks,
    })
    expect(r.reason_code).toBe("invalid_iss")
  })

  it("rejects an expired receipt as `expired`", async () => {
    const old = await sign(header(), {
      ...baseClaims(),
      iat: Math.floor(Date.now() / 1000) - 600,
      exp: Math.floor(Date.now() / 1000) - 120,
    })
    const r = await verifyReceiptOffline(old, {
      audience,
      acceptedIssuers: [issuer],
      jwks,
    })
    expect(r.reason_code).toBe("expired")
  })

  it("rejects a receipt with `oap_ver` ≠ 1.0 as `invalid_version`", async () => {
    const jwt = await sign(header(), { ...baseClaims(), oap_ver: "2.0" })
    const r = await verifyReceiptOffline(jwt, {
      audience,
      acceptedIssuers: [issuer],
      jwks,
    })
    expect(r.reason_code).toBe("invalid_version")
  })

  it("rejects a tampered payload as `bad_signature`", async () => {
    const good = await sign(header(), baseClaims())
    const parts = good.split(".") as [string, string, string]
    const claims = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString())
    claims.scope = "admin"
    const tampered = `${parts[0]}.${bytesToBase64url(new TextEncoder().encode(JSON.stringify(claims)))}.${parts[2]}`
    const r = await verifyReceiptOffline(tampered, {
      audience,
      acceptedIssuers: [issuer],
      jwks,
    })
    expect(r.reason_code).toBe("bad_signature")
  })
})

describe("rawEd25519ToJwk", () => {
  it("returns a JWK with the requested kid + curve", () => {
    const fake = bytesToBase64url(new Uint8Array(32).fill(7))
    const jwk = rawEd25519ToJwk("kid-1", fake)
    expect(jwk).toMatchObject({ kid: "kid-1", kty: "OKP", crv: "Ed25519" })
    expect(jwk.x).toBe(fake.replace(/=+$/, ""))
  })

  it("rejects a public key that does not decode to 32 bytes", () => {
    expect(() => rawEd25519ToJwk("kid-1", bytesToBase64url(new Uint8Array(10)))).toThrow(/32 bytes/)
  })
})
