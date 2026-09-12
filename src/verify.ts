import { base64urlToBytes, peekReceipt } from "./authorize/receipt.js"
import type { JwksKey, OapReasonCode, OfflineVerifyResult, ReceiptHeader } from "./authorize/types.js"
import { OAP_VERSION } from "./authorize/types.js"

/**
 * Offline verification of an oap+jwt receipt — mirrors the server-side
 * `Oap::ReceiptVerificationService.verify_offline` logic.
 *
 * Checks performed (in order):
 *   1. Structural parse (3 segments, base64url, JSON)
 *   2. Header — `alg: EdDSA`, `typ: oap+jwt`, `kid` present
 *   3. Signature — Ed25519 against the JWK matched by `kid`
 *   4. Claims — `oap_ver: "1.0"`, `iss` ∈ accepted, `aud` matches caller,
 *      `iat <= now`, `exp + 30s >= now` (30s skew)
 *
 * Returns `{ valid: false, reason_code }` for any failure; never throws
 * on receipt-shape problems — the caller renders the failure envelope.
 *
 * Network errors fetching the JWKS surface as exceptions; provide a
 * pre-fetched `jwks` array to keep verify() fully synchronous-ish.
 */
export async function verifyReceiptOffline(
  jwt: string,
  opts: {
    audience: string
    acceptedIssuers: string[]
    jwks: JwksKey[]
    /**
     * per-issuer published keys, keyed by `iss`. When the receipt's
     * issuer is present here, its keys are used (matched by `kid`) so a
     * credential issued in one region verifies against that region's published
     * key with no callback; otherwise `jwks` is used. Single-issuer unaffected.
     */
    issuerJwks?: Record<string, JwksKey[]>
    /** Tolerated clock skew in seconds (default 30). */
    skewSeconds?: number
    /** Override "now" for tests. */
    at?: Date
  }
): Promise<OfflineVerifyResult> {
  const peeked = peekReceipt(jwt)
  if (peeked === null) return fail("malformed")

  const { header, claims, signingInput, signature } = peeked

  const headerCheck = checkHeader(header)
  if (headerCheck) return failWithClaims(headerCheck)

  // prefer the presenting issuer's own published keys when supplied.
  const keySet = opts.issuerJwks?.[claims.iss] ?? opts.jwks
  const key = keySet.find((k) => k.kid === header.kid)
  if (!key) return failWithClaims("unknown_kid")

  const sigValid = await verifyEd25519(signingInput, signature, key)
  if (!sigValid) return failWithClaims("bad_signature")

  const now = Math.floor((opts.at ?? new Date()).getTime() / 1000)
  const skew = opts.skewSeconds ?? 30

  if (claims.oap_ver !== OAP_VERSION) return failWithClaims("invalid_version")
  if (!opts.acceptedIssuers.includes(claims.iss)) return failWithClaims("invalid_iss")
  if (claims.aud !== opts.audience) return failWithClaims("invalid_aud")
  if (typeof claims.iat !== "number" || claims.iat - skew > now) return failWithClaims("not_yet_valid")
  if (typeof claims.exp !== "number" || claims.exp + skew < now) return failWithClaims("expired")

  return { valid: true, claims }

  function failWithClaims(code: OapReasonCode): OfflineVerifyResult {
    return { valid: false, claims, reason_code: code }
  }
}

function fail(code: OapReasonCode): OfflineVerifyResult {
  return { valid: false, reason_code: code }
}

function checkHeader(header: ReceiptHeader): OapReasonCode | null {
  if (header.alg !== "EdDSA") return "invalid_alg"
  if (header.typ !== "oap+jwt") return "invalid_typ"
  if (!header.kid) return "unknown_kid"
  return null
}

/**
 * Verifies an Ed25519 signature using Web Crypto (Node 20+ and modern
 * browsers ship native EdDSA support; older runtimes will throw at
 * `importKey`, which we surface as `bad_signature` upstream).
 */
async function verifyEd25519(signingInput: string, signature: Uint8Array, jwk: JwksKey): Promise<boolean> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return false
  try {
    const key = await subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, { name: "Ed25519" }, false, [
      "verify",
    ])
    const data = new TextEncoder().encode(signingInput)
    return await subtle.verify(
      { name: "Ed25519" },
      key,
      // SubtleCrypto.verify expects BufferSource (ArrayBuffer | TypedArray);
      // pass the raw bytes whose backing buffer is sliced to the signature view.
      signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength) as ArrayBuffer,
      data
    )
  } catch {
    return false
  }
}

/**
 * Public-key helper — convert a base64url-encoded raw Ed25519 public key
 * (32 bytes) into the JWK shape `verifyReceiptOffline` expects.
 */
export function rawEd25519ToJwk(kid: string, rawB64Url: string): JwksKey {
  const bytes = base64urlToBytes(rawB64Url)
  if (bytes.length !== 32) {
    throw new Error(`Ed25519 public key must decode to 32 bytes (got ${bytes.length})`)
  }
  return { kid, kty: "OKP", crv: "Ed25519", x: rawB64Url.replace(/=+$/, "") }
}
