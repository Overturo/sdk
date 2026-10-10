/**
 * meetings client: the six organisation-side operations against the
 * recorded corpus, the 204 cancel, and the typed refusals.
 */
import { describe, expect, test } from "vitest"
import { OverturoMeetings } from "../../src/meetings/index.js"
import type { MeetingConsentEnvelope, MeetingConsentList, MeetingParticipantList } from "../../src/meetings/index.js"
import { OverturoApiError, OverturoUnauthorized, OverturoValidationError } from "../../src/errors.js"
import { corpusBody, corpusExchange, corpusResponse } from "../support/corpus.js"

const APP = "app_abc"
const MEETING = "vnsess_1"

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | { status: number; body: string }): {
  fetchFn: typeof fetch
  calls: Array<{ url: string; init?: RequestInit }>
} {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const out = handler(String(url), init)
    if (out instanceof Response) return out
    return new Response(out.body, { status: out.status, headers: { "content-type": "application/json" } })
  }) as typeof fetch
  return { fetchFn, calls }
}

function client(fetchFn: typeof fetch): OverturoMeetings {
  return new OverturoMeetings({ baseUrl: "https://overturo.example/", apiToken: "tok", fetchFn })
}

describe("OverturoMeetings", () => {
  test("createMeeting sends the body the API accepted and reads the window", async () => {
    const recorded = corpusExchange("Applications_MeetingConsents_create")
    const { fetchFn, calls } = fakeFetch(() => corpusResponse("Applications_MeetingConsents_create"))

    const envelope = await client(fetchFn).createMeeting(APP, recorded.request.body as never)

    expect(calls[0]?.url).toBe(`https://overturo.example/api/v1/applications/${APP}/meeting_consents`)
    expect(calls[0]?.init?.method).toBe("POST")
    expect((calls[0]?.init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok")
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(recorded.request.body)
    expect(envelope.meeting_consent.platform).toBe("zoom")
    expect(envelope.meeting_consent.participants).toEqual({ total: 0, decided: 0, undecided: 0, consented: 0 })
    expect(envelope.meeting_consent.ends_at).toBeTypeOf("string")
  })

  test("listMeetings passes the page size and reads the counts", async () => {
    const { fetchFn, calls } = fakeFetch(() => corpusResponse("Applications_MeetingConsents_index"))

    const list = await client(fetchFn).listMeetings(APP, { per_page: 10 })

    expect(calls[0]?.url).toBe(`https://overturo.example/api/v1/applications/${APP}/meeting_consents?per_page=10`)
    expect(list.meeting_consents.length).toBe(
      corpusBody<MeetingConsentList>("Applications_MeetingConsents_index").meeting_consents.length
    )
    expect(list.meeting_consents[0]?.participants.decided).toBe(2)
  })

  test("getMeeting and updateMeeting hit the member path", async () => {
    const { fetchFn, calls } = fakeFetch((url, init) =>
      init?.method === "PATCH"
        ? corpusResponse("Applications_MeetingConsents_update")
        : corpusResponse("Applications_MeetingConsents_show")
    )
    const c = client(fetchFn)

    const shown = await c.getMeeting(APP, MEETING)
    const updated = await c.updateMeeting(APP, MEETING, { title: "Corpus Review (moved)" })

    expect(calls[0]?.url).toBe(`https://overturo.example/api/v1/applications/${APP}/meeting_consents/${MEETING}`)
    expect(shown.meeting_consent.status).toBe("checked_in")
    expect(updated.meeting_consent.name).toBe(
      corpusBody<MeetingConsentEnvelope>("Applications_MeetingConsents_update").meeting_consent.name
    )
  })

  test("listParticipants reads each participant's decision per purpose", async () => {
    const { fetchFn } = fakeFetch(() => corpusResponse("Applications_MeetingConsents_participants"))

    const list = await client(fetchFn).listParticipants(APP, MEETING)

    const consented = list.participants.find((p) => p.status === "consented")
    expect(consented?.decisions).toMatchObject({ meeting_recording: "granted", ai_transcription: "declined" })
    expect(list.participants.map((p) => p.status)).toContain("declined")
    expect(list.counts).toEqual(corpusBody<MeetingParticipantList>("Applications_MeetingConsents_participants").counts)
  })

  test("cancelMeeting accepts the 204", async () => {
    const { fetchFn, calls } = fakeFetch(() => corpusResponse("Applications_MeetingConsents_destroy"))

    await expect(client(fetchFn).cancelMeeting(APP, MEETING)).resolves.toBeUndefined()
    expect(calls[0]?.init?.method).toBe("DELETE")
  })

  test("a closed meeting is a typed refusal with the machine code", async () => {
    const { fetchFn } = fakeFetch(() => ({
      status: 409,
      body: JSON.stringify({ error: "This meeting has ended or was cancelled", code: "meeting_closed" }),
    }))

    await expect(client(fetchFn).updateMeeting(APP, MEETING, { title: "x" })).rejects.toMatchObject({
      constructor: OverturoValidationError,
      reasonCode: "meeting_closed",
    })
  })

  test("401 and 404 map to their typed errors", async () => {
    const unauthorized = fakeFetch(() => ({ status: 401, body: JSON.stringify({ error: "Invalid API key" }) }))
    await expect(client(unauthorized.fetchFn).getMeeting(APP, MEETING)).rejects.toBeInstanceOf(OverturoUnauthorized)

    const missing = fakeFetch(() => ({ status: 404, body: JSON.stringify({ error: "Meeting consent not found" }) }))
    await expect(client(missing.fetchFn).getMeeting(APP, MEETING)).rejects.toBeInstanceOf(OverturoApiError)
  })

  test("refuses to build a path without ids", async () => {
    const { fetchFn } = fakeFetch(() => ({ status: 200, body: "{}" }))
    await expect(client(fetchFn).getMeeting("", MEETING)).rejects.toBeInstanceOf(OverturoValidationError)
    await expect(client(fetchFn).getMeeting(APP, "")).rejects.toBeInstanceOf(OverturoValidationError)
  })
})
