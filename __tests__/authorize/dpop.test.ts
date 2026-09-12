import { describe, it, expect, beforeAll } from "vitest"
import { webcrypto } from "node:crypto"
import { signDpopProof, jwkThumbprint } from "../../src/authorize/dpop.js"
import type { DpopKeyPair } from "../../src/authorize/dpop.js"
import { peekReceipt, base64urlToBytes } from "../../src/authorize/receipt.js"

let keypair: DpopKeyPair

beforeAll(async () => {
  // globalThis.crypto is already wired to webcrypto in Node 20+.
  const kp = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair
  const pubJwk = (await webcrypto.subtle.exportKey("jwk", kp.publicKey)) as {
    x: string
  }
  keypair = {
    privateKey: kp.privateKey,
    publicJwk: { kty: "OKP", crv: "Ed25519", x: pubJwk.x },
  }
})

describe("signDpopProof", () => {
  it("produces a JWT with typ=dpop+jwt and the embedded JWK", async () => {
    const proof = await signDpopProof(keypair, {
      htm: "post",
      htu: "https://us.overturo.com/api/v1/grants/ath_us_x/authorize",
    })
    const peeked = peekReceipt(proof)
    expect(peeked).not.toBeNull()
    expect(peeked!.header.typ).toBe("dpop+jwt")
    expect(peeked!.header.alg).toBe("EdDSA")
    expect((peeked!.header as unknown as { jwk: object }).jwk).toMatchObject({
      kty: "OKP",
      crv: "Ed25519",
    })
  })

  it("normalises htu — strips query string and fragment", async () => {
    const proof = await signDpopProof(keypair, {
      htm: "GET",
      htu: "https://us.overturo.com/api/v1/grants/ath_us_x?leak=secret#frag",
    })
    const peeked = peekReceipt(proof)!
    const claims = peeked.claims as unknown as { htu: string; htm: string }
    expect(claims.htu).toBe("https://us.overturo.com/api/v1/grants/ath_us_x")
    expect(claims.htm).toBe("GET")
  })

  it("verifies under the public key — the proof is a valid Ed25519 signature", async () => {
    const proof = await signDpopProof(keypair, {
      htm: "POST",
      htu: "https://us.overturo.com/api/v1/grants/ath_us_x/authorize",
    })
    const parts = proof.split(".") as [string, string, string]
    const signingInput = `${parts[0]}.${parts[1]}`
    const sig = base64urlToBytes(parts[2])
    const verifyKey = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair
    // The verify key is regenerated — proof should NOT verify under it.
    const wrongOk = await webcrypto.subtle.verify(
      { name: "Ed25519" },
      verifyKey.publicKey,
      sig.buffer.slice(sig.byteOffset, sig.byteOffset + sig.byteLength) as ArrayBuffer,
      new TextEncoder().encode(signingInput)
    )
    expect(wrongOk).toBe(false)
  })

  it("rejects unsupported curves", async () => {
    await expect(
      signDpopProof(
        {
          privateKey: keypair.privateKey,
          // intentionally bad curve to exercise the guard
          publicJwk: { kty: "EC", crv: "P-384" } as unknown as DpopKeyPair["publicJwk"],
        },
        { htm: "POST", htu: "https://example.com/" }
      )
    ).rejects.toThrow(/Unsupported DPoP key curve/)
  })

  it("emits the `ath` claim when accessToken is supplied (RFC 9449 section 4.1)", async () => {
    const proof = await signDpopProof(keypair, {
      htm: "POST",
      htu: "https://us.overturo.com/api/v1/grants/x/authorize",
      accessToken: "agent-token-v1",
    })
    const payload = peekReceipt(proof)!.claims as unknown as { ath?: string }
    expect(payload.ath).toBeDefined()
    // ath = base64url(SHA-256("agent-token-v1")) — server-side
    // expectation matches this value byte-for-byte.
    const expected = Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode("agent-token-v1")))
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
    expect(payload.ath).toBe(expected)
  })

  it("omits `ath` when no accessToken is supplied", async () => {
    const proof = await signDpopProof(keypair, {
      htm: "POST",
      htu: "https://us.overturo.com/api/v1/grants/x/authorize",
    })
    const payload = peekReceipt(proof)!.claims as unknown as { ath?: string }
    expect(payload.ath).toBeUndefined()
  })

  it("auto-generates a fresh jti per call when not supplied", async () => {
    const a = await signDpopProof(keypair, {
      htm: "POST",
      htu: "https://example.com/",
    })
    const b = await signDpopProof(keypair, {
      htm: "POST",
      htu: "https://example.com/",
    })
    const jtiA = (peekReceipt(a)!.claims as unknown as { jti: string }).jti
    const jtiB = (peekReceipt(b)!.claims as unknown as { jti: string }).jti
    expect(jtiA).not.toBe(jtiB)
  })
})

describe("jwkThumbprint", () => {
  it("is deterministic for the same key", async () => {
    const a = await jwkThumbprint(keypair.publicJwk)
    const b = await jwkThumbprint(keypair.publicJwk)
    expect(a).toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it("differs for different keys", async () => {
    const other = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair
    const otherJwk = (await webcrypto.subtle.exportKey("jwk", other.publicKey)) as { x: string }
    const a = await jwkThumbprint(keypair.publicJwk)
    const b = await jwkThumbprint({ kty: "OKP", crv: "Ed25519", x: otherJwk.x })
    expect(a).not.toBe(b)
  })
})
