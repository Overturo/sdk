import { describe, it, expect } from "vitest"
import { peekReceipt, base64urlToBytes, bytesToBase64url, decodeB64Url } from "../../src/authorize/receipt.js"

describe("base64url helpers", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255])
    expect(base64urlToBytes(bytesToBase64url(bytes))).toEqual(bytes)
  })

  it("emits no padding", () => {
    expect(bytesToBase64url(new Uint8Array([1, 2]))).not.toMatch(/=/)
  })

  it("is URL-safe (no + or /)", () => {
    // The byte string 0xfb 0xff 0xff would base64 to '+///' — verify the
    // URL-safe substitution kicks in.
    const b64 = bytesToBase64url(new Uint8Array([0xfb, 0xff, 0xff]))
    expect(b64).not.toMatch(/[+/]/)
    expect(b64).toMatch(/-|_/)
  })

  it("decodes b64url JSON strings", () => {
    const b64 = bytesToBase64url(new TextEncoder().encode(`{"hello":"world"}`))
    expect(decodeB64Url(b64)).toBe(`{"hello":"world"}`)
  })
})

describe("peekReceipt", () => {
  function buildReceipt(
    header: Record<string, unknown>,
    claims: Record<string, unknown>,
    sigBytes: Uint8Array = new Uint8Array([1, 2, 3])
  ): string {
    const enc = (obj: object) => bytesToBase64url(new TextEncoder().encode(JSON.stringify(obj)))
    return `${enc(header)}.${enc(claims)}.${bytesToBase64url(sigBytes)}`
  }

  it("returns header + claims + signature for a well-formed JWT triple", () => {
    const jwt = buildReceipt(
      { alg: "EdDSA", typ: "oap+jwt", kid: "oap-us-v1" },
      { iss: "https://us.overturo.com", aud: "did:web:cp.example", jti: "n1" }
    )
    const peeked = peekReceipt(jwt)
    expect(peeked).not.toBeNull()
    expect(peeked!.header.kid).toBe("oap-us-v1")
    expect(peeked!.claims.jti).toBe("n1")
    expect(peeked!.signingInput.split(".")).toHaveLength(2)
    expect(peeked!.signature).toBeInstanceOf(Uint8Array)
  })

  it("returns null for non-JWT input", () => {
    expect(peekReceipt("not-a-jwt")).toBeNull()
    expect(peekReceipt("")).toBeNull()
    expect(peekReceipt("a.b")).toBeNull()
  })

  it("returns null when a segment is not valid JSON", () => {
    const badPayload = bytesToBase64url(new TextEncoder().encode("{not-json"))
    expect(peekReceipt(`aaa.${badPayload}.bbb`)).toBeNull()
  })

  it("returns null when input is not a string", () => {
    // Cast to bypass TS — the runtime guard is the contract.
    expect(peekReceipt(123 as unknown as string)).toBeNull()
  })
})
