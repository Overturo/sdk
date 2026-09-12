/**
 * receipts client: flavor matrix, both 422 shapes, scopes,
 * 404, and the raw-text path for signed retrieval.
 */
import { describe, expect, test } from "vitest"
import { OverturoReceipts } from "../../src/receipts/index.js"
import { OverturoApiError, OverturoUnauthorized, OverturoValidationError } from "../../src/errors.js"
import { corpusBody } from "../support/corpus.js"

// The recorded exchange the real API produced (validated against the published document).
const CANONICAL_BODY = corpusBody<Record<string, unknown>>("AuthorizationReceipts_show")

function fakeFetch(
  handler: (url: string, init?: RequestInit) => { status: number; body: string; contentType?: string }
): { fetchFn: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const { status, body, contentType } = handler(String(url), init)
    return new Response(body, {
      status,
      headers: { "content-type": contentType ?? "application/json" },
    })
  }) as typeof fetch
  return { fetchFn, calls }
}

function client(fetchFn: typeof fetch): OverturoReceipts {
  return new OverturoReceipts({ baseUrl: "https://overturo.example/", apiToken: "tok", fetchFn })
}

describe("retrieveAuthorizationReceipt", () => {
  test("canonical default sends no flavor, bearer auth, and unwraps", async () => {
    const { fetchFn, calls } = fakeFetch(() => ({ status: 200, body: JSON.stringify(CANONICAL_BODY) }))

    const doc = await client(fetchFn).retrieveAuthorizationReceipt("acc_123")

    expect((doc["record"] as Record<string, unknown>)["record_type"]).toBe("authorization_record")
    expect((doc["record"] as Record<string, unknown>)["record_id"]).toBe("<PREFIX_ID:1>")
    expect(calls[0]?.url).toBe("https://overturo.example/api/v1/authorization_receipts/acc_123")
    expect((calls[0]?.init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok")
  })

  test("signed flavor returns the bare envelope object", async () => {
    const envelope = { receipt: { record: {} }, signature: { algorithm: "Ed25519" } }
    const { fetchFn, calls } = fakeFetch(() => ({ status: 200, body: JSON.stringify(envelope) }))

    const doc = await client(fetchFn).retrieveAuthorizationReceipt("acc_123", { flavor: "signed" })

    expect(Object.keys(doc)).toEqual(["receipt", "signature"])
    expect(calls[0]?.url).toContain("?flavor=signed")
  })

  test("dpv flavor parses despite application/ld+json", async () => {
    const dpv = { "@type": "dpv:ConsentRecord" }
    const { fetchFn } = fakeFetch(() => ({
      status: 200,
      body: JSON.stringify(dpv),
      contentType: "application/ld+json",
    }))

    const doc = await client(fetchFn).retrieveAuthorizationReceipt("acc_123", { flavor: "dpv" })

    expect(doc["@type"]).toBe("dpv:ConsentRecord")
  })

  test("the read's typed 422 shape ({error: code, reason}) surfaces reasonCode", async () => {
    for (const [code, body] of [
      ["unknown_flavor", { error: "unknown_flavor" }],
      ["not_signable", { error: "not_signable", reason: "no frozen snapshot" }],
      ["dpv_unavailable", { error: "dpv_unavailable", reason: "no PII slice" }],
    ] as const) {
      const { fetchFn } = fakeFetch(() => ({ status: 422, body: JSON.stringify(body) }))
      await expect(client(fetchFn).retrieveAuthorizationReceipt("acc_123", { flavor: "dpv" })).rejects.toMatchObject({
        name: "OverturoValidationError",
        reasonCode: code,
      })
    }
  })

  test("missing scope is a typed 403", async () => {
    const { fetchFn } = fakeFetch(() => ({
      status: 403,
      body: JSON.stringify({ error: "Requires audit:verify scope" }),
    }))

    await expect(client(fetchFn).retrieveAuthorizationReceipt("acc_123")).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof OverturoUnauthorized && e.reasonCode === "missing_scope" && e.message.includes("audit:verify")
    )
  })

  test("the parity-preserving 404", async () => {
    const { fetchFn } = fakeFetch(() => ({
      status: 404,
      body: JSON.stringify({ error: "Authorization record not found" }),
    }))

    await expect(client(fetchFn).retrieveAuthorizationReceipt("acc_nope")).rejects.toSatisfy(
      (e: unknown) => e instanceof OverturoApiError && e.httpStatus === 404
    )
  })
})

describe("retrieveSignedAuthorizationReceiptRaw", () => {
  test("returns the raw body text untouched (the verifyRecord input)", async () => {
    const raw = '{"receipt":{"n":5.0},"signature":{"algorithm":"Ed25519"}}'
    const { fetchFn, calls } = fakeFetch(() => ({ status: 200, body: raw }))

    const text = await client(fetchFn).retrieveSignedAuthorizationReceiptRaw("acc_123")

    expect(text).toBe(raw) // lexemes intact — "5.0" not collapsed to "5"
    expect(calls[0]?.url).toContain("?flavor=signed")
  })
})

describe("createDisclosureReceipt", () => {
  test("posts the closed snake_case payload and unwraps", async () => {
    const { fetchFn, calls } = fakeFetch(() => ({
      status: 201,
      body: JSON.stringify({
        disclosure_receipt: { record_id: "ct_disc1", record: { record: { record_type: "notice_record" } } },
      }),
    }))

    const receipt = await client(fetchFn).createDisclosureReceipt({
      flowId: "acc_flow1",
      agentId: "agt_1",
      disclosedAt: "2026-08-06T10:00:00Z",
      locale: "en",
    })

    expect(receipt.record_id).toBe("ct_disc1")
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      flow_id: "acc_flow1",
      agent_id: "agt_1",
      disclosed_at: "2026-08-06T10:00:00Z",
      locale: "en",
    })
  })

  test("the mint's typed 422 shape ({error: message, code}) surfaces reasonCode", async () => {
    const { fetchFn } = fakeFetch(() => ({
      status: 422,
      body: JSON.stringify({
        error: "the named flow does not disclose this agent",
        code: "agent_not_disclosed",
      }),
    }))

    await expect(
      client(fetchFn).createDisclosureReceipt({
        flowId: "acc_flow1",
        agentId: "agt_other",
        disclosedAt: "2026-08-06T10:00:00Z",
      })
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof OverturoValidationError &&
        e.reasonCode === "agent_not_disclosed" &&
        e.message.includes("does not disclose")
    )
  })
})
