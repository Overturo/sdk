import type { ReceiptClaims, ReceiptHeader } from "./types.js"

/**
 * Anonymous decode of an oap+jwt receipt — does NOT verify the signature.
 * Use {@link verifyReceiptOffline} when you need authenticity.
 *
 * Returns null when the input isn't a parseable JWT triple, rather than
 * throwing, so callers can build error envelopes without try/catch.
 */
export function peekReceipt(
  jwt: string
): { header: ReceiptHeader; claims: ReceiptClaims; signingInput: string; signature: Uint8Array } | null {
  if (typeof jwt !== "string") return null
  const parts = jwt.split(".")
  if (parts.length !== 3) return null
  const [headerB64, claimsB64, sigB64] = parts as [string, string, string]
  try {
    const header = JSON.parse(decodeB64Url(headerB64)) as ReceiptHeader
    const claims = JSON.parse(decodeB64Url(claimsB64)) as ReceiptClaims
    const signature = base64urlToBytes(sigB64)
    return {
      header,
      claims,
      signingInput: `${headerB64}.${claimsB64}`,
      signature,
    }
  } catch {
    return null
  }
}

/** Base64url → utf-8 string, padding-tolerant. */
export function decodeB64Url(b64url: string): string {
  return new TextDecoder().decode(base64urlToBytes(b64url))
}

/** Base64url → Uint8Array, padding-tolerant. Throws on invalid chars. */
export function base64urlToBytes(b64url: string): Uint8Array {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4)
  const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/")
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"))
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Uint8Array → base64url (no padding). */
export function bytesToBase64url(bytes: Uint8Array): string {
  let b64: string
  if (typeof Buffer !== "undefined") {
    b64 = Buffer.from(bytes).toString("base64")
  } else {
    let binary = ""
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
    b64 = btoa(binary)
  }
  return b64.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")
}
