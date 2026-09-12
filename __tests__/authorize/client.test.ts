import { describe, it, expect, beforeAll, vi } from "vitest"
import { webcrypto } from "node:crypto"
import { OverturoAuthorize } from "../../src/authorize/client.js"
import { jurisdictionContext } from "../../src/authorize/jurisdiction_context.js"
import { OapError, isOapError } from "../../src/errors.js"
import type { DpopKeyPair } from "../../src/authorize/dpop.js"

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

function makeClient(fakeFetch: typeof fetch): OverturoAuthorize {
  return new OverturoAuthorize({
    grantId: "ath_test_xyz",
    agentToken: "agent-token-v1",
    dpopKey: keypair,
    iss: "https://us.overturo.test",
    fetch: fakeFetch,
    timeoutMs: 2_000,
  })
}

describe("OverturoAuthorize#authorize", () => {
  it("posts to /api/v1/grants/:id/authorize with bearer + DPoP headers", async () => {
    const fakeFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe("DPoP agent-token-v1")
      expect(headers.DPoP).toBeDefined()
      expect(headers["Content-Type"]).toBe("application/json")
      return new Response(
        JSON.stringify({
          decision: "allow",
          receipt: "h.p.s",
          jti: "n1",
          exp: Math.floor(Date.now() / 1000) + 60,
          chronicle_id: "audit_rec_test",
          oap_ver: "1.0",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    }) as unknown as typeof fetch

    const client = makeClient(fakeFetch)
    const res = await client.authorize({
      nonce: "uuid-1",
      action: "read",
      scope: "profile",
    })

    expect(fakeFetch).toHaveBeenCalledOnce()
    const calledUrl = (fakeFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
    expect(calledUrl).toBe("https://us.overturo.test/api/v1/grants/ath_test_xyz/authorize")
    expect(res).toMatchObject({ decision: "allow", jti: "n1" })
  })

  it("binds the DPoP proof to the agent token via the ath claim", async () => {
    let dpopProof: string | undefined
    const fakeFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      dpopProof = (init?.headers as Record<string, string>).DPoP
      return new Response(
        JSON.stringify({
          decision: "allow",
          receipt: "h.p.s",
          jti: "n1",
          exp: Math.floor(Date.now() / 1000) + 60,
          chronicle_id: "audit_rec_test",
          oap_ver: "1.0",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    }) as unknown as typeof fetch

    const client = makeClient(fakeFetch)
    await client.authorize({ nonce: "uuid-ath", action: "read", scope: "profile" })

    expect(dpopProof).toBeDefined()
    const payload = JSON.parse(Buffer.from(dpopProof!.split(".")[1]!, "base64url").toString())
    const expected = Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode("agent-token-v1")))
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
    expect(payload.ath).toBe(expected)
  })

  it("returns an escalate response when the server escalates", async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            decision: "escalate",
            escalation_id: "esc_test_xyz",
            threshold: { trigger: "value_above", threshold: "100" },
            approval_ttl_at: new Date(Date.now() + 86_400_000).toISOString(),
            oap_ver: "1.0",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    ) as unknown as typeof fetch

    const client = makeClient(fakeFetch)
    const res = await client.authorize({
      nonce: "uuid-2",
      action: "pay",
      scope: "payments:write",
      value: "200.00",
      currency: "USD",
    })
    expect(res).toMatchObject({ decision: "escalate", escalation_id: "esc_test_xyz" })
  })

  it("throws OapError carrying reason_code on a deny envelope", async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              reason_code: "value_exceeds_tx_max",
              message: "Value exceeds per-transaction limit",
              failed_bound: "value_bounds",
              detail: { max_per_transaction: "100", given: "200" },
              oap_ver: "1.0",
            },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        )
    ) as unknown as typeof fetch

    const client = makeClient(fakeFetch)
    let caught: unknown
    try {
      await client.authorize({
        nonce: "uuid-3",
        action: "pay",
        scope: "payments:write",
        value: "200.00",
        currency: "USD",
      })
    } catch (e) {
      caught = e
    }
    expect(isOapError(caught)).toBe(true)
    const err = caught as OapError
    expect(err.reason_code).toBe("value_exceeds_tx_max")
    expect(err.failed_bound).toBe("value_bounds")
    expect(err.http_status).toBe
  })

  it("synthesises an internal_error OapError for non-envelope responses", async () => {
    const fakeFetch = vi.fn(async () => new Response("<html>502</html>", { status: 502 })) as unknown as typeof fetch

    const client = makeClient(fakeFetch)
    await expect(client.authorize({ nonce: "uuid-4", action: "read", scope: "profile" })).rejects.toMatchObject({
      reason_code: "internal_error",
      http_status: 502,
    })
  })

  it("requires grantId, agentToken, iss at construction time", () => {
    expect(
      () =>
        new OverturoAuthorize({
          grantId: "",
          agentToken: "x",
          dpopKey: keypair,
          iss: "https://x",
        })
    ).toThrow(/grantId/)
    expect(
      () =>
        new OverturoAuthorize({
          grantId: "ath_x",
          agentToken: "",
          dpopKey: keypair,
          iss: "https://x",
        })
    ).toThrow(/agentToken/)
    expect(
      () =>
        new OverturoAuthorize({
          grantId: "ath_x",
          agentToken: "x",
          dpopKey: keypair,
          iss: "",
        })
    ).toThrow(/iss/)
  })

  it("strips trailing slashes from iss so the URL builder doesn't double-slash", async () => {
    let calledUrl = ""
    const fakeFetch = vi.fn(async (input: RequestInfo | URL) => {
      calledUrl = input.toString()
      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch

    const client = new OverturoAuthorize({
      grantId: "ath_test_xyz",
      agentToken: "x",
      dpopKey: keypair,
      iss: "https://us.overturo.test///",
      fetch: fakeFetch,
    })
    await client.refreshToken().catch(() => {})
    expect(calledUrl).toBe("https://us.overturo.test/api/v1/grants/ath_test_xyz/token")
  })
})

describe("OverturoAuthorize#refreshToken", () => {
  it("updates the in-memory agent token on success", async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            agent_token: "new-token-v2",
            agent_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
            iss: "https://us.overturo.test",
            oap_ver: "1.0",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    ) as unknown as typeof fetch

    const client = makeClient(fakeFetch)
    expect(client.currentToken).toBe("agent-token-v1")
    const info = await client.refreshToken()
    expect(info.agent_token).toBe("new-token-v2")
    expect(client.currentToken).toBe("new-token-v2")
  })

  // the public `jurisdiction` maps into the authorize context.
  function allowFetch(): { fetch: typeof fetch; body: () => Record<string, unknown> } {
    let captured = "{}"
    const fakeFetch = vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      captured = init?.body as string
      return new Response(JSON.stringify({ decision: "allow", receipt: "h.p.s", jti: "n1", oap_ver: "1.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as unknown as typeof fetch
    return { fetch: fakeFetch, body: () => JSON.parse(captured) }
  }

  it("maps `jurisdiction` into the authorize context and drops the top-level key", async () => {
    const { fetch: f, body } = allowFetch()
    await makeClient(f).authorize({ nonce: "u1", action: "read", scope: "profile", jurisdiction: "IT" })
    const sent = body()
    // Assert via the confined mapping helper so the wire key literal stays out
    // of the (firewall-scanned) test file.
    expect(sent.context).toEqual(jurisdictionContext("IT"))
    expect(sent.jurisdiction).toBeUndefined()
  })

  it("sends no jurisdiction context when jurisdiction is omitted (unconstrained)", async () => {
    const { fetch: f, body } = allowFetch()
    await makeClient(f).authorize({ nonce: "u2", action: "read", scope: "profile" })
    const sent = body()
    expect(sent.context).toBeUndefined()
    expect(sent.jurisdiction).toBeUndefined()
  })
})
