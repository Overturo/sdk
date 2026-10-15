/**
 * consent records client: the Record API, the import and the status read
 * against the recorded corpus, and the typed refusals.
 */
import { describe, expect, test } from "vitest"
import { OverturoConsentRecords } from "../../src/consent_records/index.js"
import { OverturoValidationError } from "../../src/errors.js"
import { corpusBody, corpusExchange, corpusResponse } from "../support/corpus.js"

function fakeFetch(handler: (url: string, init?: RequestInit) => Response): {
  fetchFn: typeof fetch
  calls: Array<{ url: string; init?: RequestInit }>
} {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }) as typeof fetch
  return { fetchFn, calls }
}

function client(fetchFn: typeof fetch): OverturoConsentRecords {
  return new OverturoConsentRecords({ baseUrl: "https://overturo.example/", apiToken: "tok", fetchFn })
}

describe("OverturoConsentRecords", () => {
  test("create sends the body the API accepted and reads the record", async () => {
    const recorded = corpusExchange("ConsentRecords_create")
    const { fetchFn, calls } = fakeFetch(() => corpusResponse("ConsentRecords_create"))

    const envelope = await client(fetchFn).create(recorded.request.body as never)

    expect(calls[0]?.url).toBe("https://overturo.example/api/v1/consent_records")
    expect(calls[0]?.init?.method).toBe("POST")
    expect((calls[0]?.init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok")
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(recorded.request.body)
    expect(envelope.consent_record.status).toBe("fulfilled")
    expect(envelope.consent_record.channel).toBe("controller_attested")
    expect(envelope.consent_record.purposes.map((p) => p.key)).toContain("marketing")
  })

  test("retrieve reads the record", async () => {
    const body = corpusBody<{ consent_record: { id: string } }>("ConsentRecords_show")
    const { fetchFn, calls } = fakeFetch(() => corpusResponse("ConsentRecords_show"))
    const envelope = await client(fetchFn).retrieve(body.consent_record.id)
    expect(calls[0]?.url).toContain(`/api/v1/consent_records/${encodeURIComponent(body.consent_record.id)}`)
    expect(envelope.consent_record.id).toBe(body.consent_record.id)
  })

  test("commitCapture commits the snippet's capture token with the application credential", async () => {
    const recorded = corpusExchange("Decisions_authorize")
    const { fetchFn, calls } = fakeFetch(() => corpusResponse("Decisions_authorize"))
    const envelope = await client(fetchFn).commitCapture("<TOKEN>", recorded.request.body as never)
    expect(calls[0]?.url).toContain("/api/v1/decisions/")
    expect(calls[0]?.url).toContain("/authorize")
    expect(calls[0]?.init?.method).toBe("POST")
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(recorded.request.body)
    expect(envelope.decision.status).toBe("fulfilled")
    expect(envelope.decision.channel).toBe("form_capture")
    expect(envelope.decision.record_id).toBeTruthy()
  })

  test("import and retrieveImport", async () => {
    const recorded = corpusExchange("ConsentRecords_imports")
    const { fetchFn } = fakeFetch(() => corpusResponse("ConsentRecords_imports"))
    const result = await client(fetchFn).import(recorded.request.body as never)
    expect(result.import.dry_run).toBe(true)
    expect(result.import.row_count).toBe(1)

    const body = corpusBody<{ import: { id: string } }>("ConsentRecords_import")
    const second = fakeFetch(() => corpusResponse("ConsentRecords_import"))
    const status = await client(second.fetchFn).retrieveImport(body.import.id)
    expect(status.import.id).toBe(body.import.id)
  })

  test("status by subject reference", async () => {
    const body = corpusBody<{ application_id: string }>("Applications_ConsentStatuses_lookup")
    const { fetchFn, calls } = fakeFetch(() => corpusResponse("Applications_ConsentStatuses_lookup"))
    const result = await client(fetchFn).status(body.application_id, { email: "contract-status@example.com" })
    expect(calls[0]?.url).toContain("subject%5Bemail%5D=contract-status%40example.com")
    expect(result.application_id).toBe(body.application_id)
    expect(Array.isArray(result.purposes)).toBe(true)
  })

  test("refuses before the network", async () => {
    const { fetchFn, calls } = fakeFetch(() => new Response("{}"))
    const c = client(fetchFn)
    await expect(c.create({ flow_id: "", subject: { email: "a@b" }, decisions: { m: { decision: "granted" } } })).rejects.toBeInstanceOf(OverturoValidationError)
    await expect(c.create({ flow_id: "flw", subject: { email: "" }, decisions: { m: { decision: "granted" } } })).rejects.toBeInstanceOf(OverturoValidationError)
    await expect(c.import({ flow_id: "flw", records: [] })).rejects.toBeInstanceOf(OverturoValidationError)
    await expect(c.status("app", {})).rejects.toBeInstanceOf(OverturoValidationError)
    expect(calls).toHaveLength(0)
  })

  test("maps a 422 refusal to a validation error carrying the code", async () => {
    const { fetchFn } = fakeFetch(
      () => new Response(JSON.stringify({ error: { code: "pre_ticked_consent", message: "refused", purpose: "marketing" } }), { status: 422 })
    )
    await expect(client(fetchFn).create({ flow_id: "flw", subject: { email: "a@b" }, decisions: { m: { decision: "granted" } } }))
      .rejects.toMatchObject({ reasonCode: "pre_ticked_consent" })
  })
})
