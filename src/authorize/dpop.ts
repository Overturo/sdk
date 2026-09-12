import { bytesToBase64url } from "./receipt.js"

/**
 * RFC 9449 DPoP proof generation.
 *
 * The agent SDK holds a long-lived Ed25519 (Ed25519) or ECDSA P-256 key
 * pair; each request signs a fresh JWT proof with `htu` (URL) + `htm`
 * (method) + `iat` + `jti`. The server side validates the proof's
 * signature, freshness window, and JWK thumbprint match.
 *
 * v1.0 binds DPoP keys at grant-creation time; the agent presents the
 * same key on every authorize call, so the platform's `cnf.jkt` claim
 * pins token-to-key.
 */

export interface DpopKeyPair {
  /** Imported CryptoKey usable for `sign`. */
  privateKey: CryptoKey
  /** Public JWK — embedded in the DPoP proof header. */
  publicJwk: DpopPublicJwk
}

export type DpopPublicJwk =
  | { kty: "OKP"; crv: "Ed25519"; x: string }
  | { kty: "EC"; crv: "P-256"; x: string; y: string }

export interface DpopProofParams {
  /** HTTP method (GET/POST/...) in upper-case. */
  htm: string
  /** Full HTTP URL including scheme/host/path. Query stripped before signing. */
  htu: string
  /** Unix-seconds clock override for tests. Defaults to now. */
  iat?: number
  /** Fresh per-proof identifier; auto-generated when omitted. */
  jti?: string
  /**
   * Access token to bind to the proof (RFC 9449 section 4.1). When set, the
   * proof's `ath` claim is the base64url SHA-256 of the token bytes —
   * the server rejects DPoP proofs without `ath` whenever the request
   * also carries a `DPoP <token>` Authorization header. The
   * OverturoAuthorize client wires this automatically; bare callers
   * of `signDpopProof` must pass it themselves when sending the proof
   * alongside a bearer token.
   */
  accessToken?: string
}

const ALG_FROM_CRV: Record<string, "EdDSA" | "ES256"> = {
  Ed25519: "EdDSA",
  "P-256": "ES256",
}

/**
 * Sign a DPoP proof JWT. Returns the compact JWS string.
 *
 * The `htu` is normalised per RFC 9449 section 4.2 — query string and fragment
 * are stripped before signing because the server applies the same
 * normalisation on validation.
 */
export async function signDpopProof(keypair: DpopKeyPair, params: DpopProofParams): Promise<string> {
  const alg = ALG_FROM_CRV[keypair.publicJwk.crv]
  if (!alg) {
    throw new Error(`Unsupported DPoP key curve: ${keypair.publicJwk.crv}. Use Ed25519 or P-256.`)
  }

  const header = {
    typ: "dpop+jwt",
    alg,
    jwk: keypair.publicJwk,
  }
  const payload: Record<string, string | number> = {
    htm: params.htm.toUpperCase(),
    htu: normaliseHtu(params.htu),
    iat: params.iat ?? Math.floor(Date.now() / 1000),
    jti: params.jti ?? randomJti(),
  }
  if (params.accessToken) {
    payload.ath = await accessTokenHash(params.accessToken)
  }

  const enc = (obj: object) => bytesToBase64url(new TextEncoder().encode(JSON.stringify(obj)))
  const headerB64 = enc(header)
  const payloadB64 = enc(payload)
  const signingInput = `${headerB64}.${payloadB64}`

  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error("DPoP requires Web Crypto (globalThis.crypto.subtle) — Node 20+ or modern browser.")
  }

  const sig = await subtle.sign(sigParams(alg), keypair.privateKey, new TextEncoder().encode(signingInput))
  return `${signingInput}.${bytesToBase64url(new Uint8Array(sig))}`
}

function sigParams(alg: "EdDSA" | "ES256"): AlgorithmIdentifier | EcdsaParams {
  return alg === "EdDSA" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" }
}

function normaliseHtu(url: string): string {
  try {
    const u = new URL(url)
    u.search = ""
    u.hash = ""
    return u.toString()
  } catch {
    return url
  }
}

function randomJti(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return bytesToBase64url(bytes)
}

/**
 * RFC 9449 section 4.1 access token hash (`ath`): SHA-256 of the raw access
 * token bytes, base64url-encoded with no padding. The server-side
 * verifier rejects with `dpop_invalid: "missing ath"` whenever a
 * bearer + DPoP proof reach an endpoint without it.
 */
export async function accessTokenHash(accessToken: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error("accessTokenHash requires Web Crypto.")
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(accessToken))
  return bytesToBase64url(new Uint8Array(digest))
}

/**
 * RFC 7638 JWK thumbprint (SHA-256). Used both internally (to bind
 * tokens to keys) and exposed so SDK users can compute the same `jkt`
 * the platform expects at grant creation time.
 */
export async function jwkThumbprint(jwk: DpopPublicJwk): Promise<string> {
  // Canonical member ordering per RFC 7638 section 3 — alphabetic, no whitespace.
  const canonical =
    jwk.kty === "OKP"
      ? `{"crv":"Ed25519","kty":"OKP","x":"${jwk.x}"}`
      : `{"crv":"P-256","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error("jwkThumbprint requires Web Crypto.")
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(canonical))
  return bytesToBase64url(new Uint8Array(digest))
}
