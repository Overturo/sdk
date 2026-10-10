/**
 * Meetings — the organisation's side of meeting consent. A meeting is the
 * unit of record: it has a window (scheduled_at / ends_at), a platform
 * identity, a cancellation, and participant rows that carry each person's
 * decision per purpose.
 *
 * Wire endpoints (API token bearer, the application's admin scope):
 *
 *     GET    /api/v1/applications/:application_id/meeting_consents
 *     POST   /api/v1/applications/:application_id/meeting_consents
 *     GET    /api/v1/applications/:application_id/meeting_consents/:id
 *     PATCH  /api/v1/applications/:application_id/meeting_consents/:id
 *     DELETE /api/v1/applications/:application_id/meeting_consents/:id   (cancel)
 *     GET    /api/v1/applications/:application_id/meeting_consents/:id/participants
 *
 * Wire shape verbatim (snake_case): this server client does NOT camelCase.
 * The participant pair (a participant's own status / withdrawal) lives in
 * the browser SDK, where the session token is.
 */
import {
  OverturoApiError,
  OverturoNetworkError,
  OverturoRateLimited,
  OverturoServerError,
  OverturoUnauthorized,
  OverturoValidationError,
} from "../errors.js"

export interface MeetingParticipantCounts {
  total: number
  decided: number
  undecided: number
  consented?: number
}

export interface MeetingConsent {
  id: string
  application_id: string
  name: string | null
  description?: string | null
  status: "checked_in" | "checked_out" | "expired"
  cancelled_at: string | null
  platform: string | null
  external_meeting_id?: string | null
  scheduled_at: string | null
  ends_at: string | null
  template?: string | null
  consent_link: string | null
  consented_count?: number
  participants: MeetingParticipantCounts
  created_at: string
  updated_at: string
}

export interface MeetingConsentEnvelope {
  meeting_consent: MeetingConsent
  consent_link?: string | null
  consented_count?: number
}

export interface MeetingConsentList {
  meeting_consents: MeetingConsent[]
  pagination?: { page: number; per_page: number; total: number; pages: number }
}

export type MeetingParticipantDecision = "granted" | "declined" | "withdrawn"

export interface MeetingParticipant {
  id: string
  status: string
  source: string
  name: string | null
  email: string | null
  decisions: Record<string, MeetingParticipantDecision>
  decided_at: string | null
  withdrawn_at: string | null
}

export interface MeetingParticipantList {
  participants: MeetingParticipant[]
  total: number
  counts?: MeetingParticipantCounts
}

export interface CreateMeetingInput {
  template?: string
  title?: string
  description?: string
  /** ISO 8601. */
  scheduled_at?: string
  /** Defaults to 60 on the server; sets ends_at. */
  duration_minutes?: number
  platform?: string
  external_meeting_id?: string
  agent_ids?: string[]
}

export interface UpdateMeetingInput {
  title?: string
  /** ISO 8601 — a new start reschedules the meeting. */
  scheduled_at?: string
  duration_minutes?: number
  platform?: string
  external_meeting_id?: string
}

export interface ListMeetingsOptions {
  page?: number
  per_page?: number
}

export interface OverturoMeetingsOpts {
  baseUrl: string
  apiToken: string
  /** Injectable fetch (tests / custom transport). */
  fetchFn?: typeof fetch
  timeoutMs?: number
}

export class OverturoMeetings {
  private readonly baseUrl: string
  private readonly apiToken: string
  private readonly fetchFn: typeof fetch
  private readonly timeoutMs: number

  constructor(opts: OverturoMeetingsOpts) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "")
    this.apiToken = opts.apiToken
    this.fetchFn = opts.fetchFn ?? fetch
    this.timeoutMs = opts.timeoutMs ?? 10_000
  }

  /** The application's meetings, newest first. */
  async listMeetings(applicationId: string, opts: ListMeetingsOptions = {}): Promise<MeetingConsentList> {
    const qs = new URLSearchParams()
    if (opts.page !== undefined) qs.set("page", String(opts.page))
    if (opts.per_page !== undefined) qs.set("per_page", String(opts.per_page))
    const suffix = qs.size > 0 ? `?${qs.toString()}` : ""
    return this.json<MeetingConsentList>("GET", `${this.collectionPath(applicationId)}${suffix}`)
  }

  /** Creates a meeting and its consent flow; answers the meeting-named consent link. */
  async createMeeting(applicationId: string, input: CreateMeetingInput): Promise<MeetingConsentEnvelope> {
    return this.json<MeetingConsentEnvelope>("POST", this.collectionPath(applicationId), input)
  }

  async getMeeting(applicationId: string, meetingId: string): Promise<MeetingConsentEnvelope> {
    return this.json<MeetingConsentEnvelope>("GET", this.memberPath(applicationId, meetingId))
  }

  /** Rename or reschedule; the window and the participants' calendar sequence follow. */
  async updateMeeting(
    applicationId: string,
    meetingId: string,
    input: UpdateMeetingInput
  ): Promise<MeetingConsentEnvelope> {
    return this.json<MeetingConsentEnvelope>("PATCH", this.memberPath(applicationId, meetingId), input)
  }

  /** Cancels the meeting (participants are told; the record stays). */
  async cancelMeeting(applicationId: string, meetingId: string): Promise<void> {
    await this.request("DELETE", this.memberPath(applicationId, meetingId))
  }

  /** The meeting's participants with their decision per purpose. */
  async listParticipants(applicationId: string, meetingId: string): Promise<MeetingParticipantList> {
    return this.json<MeetingParticipantList>("GET", `${this.memberPath(applicationId, meetingId)}/participants`)
  }

  // ── internals ────────────────────────────────────────────────────

  private collectionPath(applicationId: string): string {
    if (!applicationId) throw new OverturoValidationError("applicationId is required")
    return `/api/v1/applications/${encodeURIComponent(applicationId)}/meeting_consents`
  }

  private memberPath(applicationId: string, meetingId: string): string {
    if (!meetingId) throw new OverturoValidationError("meetingId is required")
    return `${this.collectionPath(applicationId)}/${encodeURIComponent(meetingId)}`
  }

  private async json<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
    const text = await this.request(method, path, body)
    try {
      return JSON.parse(text) as T
    } catch {
      throw new OverturoApiError("Malformed response: not JSON", {})
    }
  }

  private async request(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    jsonBody?: unknown
  ): Promise<string> {
    let response: Response
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          Accept: "application/json",
          ...(jsonBody !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(jsonBody !== undefined ? { body: JSON.stringify(jsonBody) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (e) {
      throw new OverturoNetworkError(e instanceof Error ? e.message : String(e))
    }

    const text = await response.text()
    if (response.ok) return text

    raiseFor(response.status, text)
    throw new Error("unreachable")
  }
}

function raiseFor(status: number, text: string): never {
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>
    }
  } catch {
    // non-JSON error body — fall through with the raw text as message
  }
  const message = typeof body["error"] === "string" ? (body["error"] as string) : `HTTP ${status}`
  const code = typeof body["code"] === "string" ? (body["code"] as string) : undefined

  if (status === 401) throw new OverturoUnauthorized(message, { httpStatus: status })
  if (status === 403) throw new OverturoUnauthorized(message, { httpStatus: status, reasonCode: "missing_scope" })
  if (status === 404) throw new OverturoApiError(message, { httpStatus: status, reasonCode: code ?? "not_found" })
  if (status === 409 || status === 422) {
    throw new OverturoValidationError(message, { httpStatus: status, reasonCode: code, detail: body["error"] })
  }
  if (status === 429) throw new OverturoRateLimited(message)
  if (status >= 500) throw new OverturoServerError(message, { httpStatus: status })
  throw new OverturoApiError(message, { httpStatus: status })
}
