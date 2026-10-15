// 201 — consent records captured outside Overturo's surfaces: the Record API
// (create = capture + commit in one call, idempotent on your key), the read,
// the batch import with its dry run, and the status read by the subject
// reference you supplied (email or your own identifier). API-token bearer.
import {
  OverturoApiError,
  OverturoNetworkError,
  OverturoRateLimited,
  OverturoServerError,
  OverturoUnauthorized,
  OverturoValidationError,
} from "../errors.js"

export interface AttestedDecision {
  decision: "granted" | "declined"
  default_checked?: boolean
  mandatory?: boolean
}

export interface ConsentRecordSubject {
  email: string
  external_id?: string
}

export interface CreateConsentRecordInput {
  flow_id: string
  subject: ConsentRecordSubject
  decisions: Record<string, AttestedDecision>
  captured_at?: string
  idempotency_key?: string
  notice_hash?: string
  locale?: string
  suppress_receipt?: boolean
  client_facts?: Record<string, string>
}

export interface ConsentRecordPurposeOutcome {
  key: string
  outcome: "granted" | "declined" | "revoked" | "noticed" | "objected"
  basis: string | null
}

export interface ConsentRecord {
  id: string
  status: "fulfilled" | "revoked" | "expired"
  flow_id?: string
  channel?: string
  purposes: ConsentRecordPurposeOutcome[]
  receipt_id: string
  wording_verdict?: string | null
  subject?: { email?: string; external_id?: string | null }
  captured_at?: string | null
  recorded_at?: string | null
  expires_at?: string | null
}

export interface ConsentRecordEnvelope {
  consent_record: ConsentRecord
}

/** 201 — the capture commit's body: the person your server knows, and whether to send the receipt. */
export interface CommitCaptureInput {
  subject?: { email?: string; external_id?: string }
  suppress_receipt?: boolean
}

export interface DecisionAuthorizedEnvelope {
  decision: {
    status: string
    consent_token?: string
    consent_token_expires_at?: string
    record_id?: string
    receipt_id?: string
    channel?: string
  }
}

export interface ImportConsentRecordsInput {
  flow_id: string
  records: Array<Omit<CreateConsentRecordInput, "flow_id" | "suppress_receipt" | "client_facts"> & { captured_at: string }>
  dry_run?: boolean
  send_receipts?: boolean
}

export interface ConsentRecordImport {
  id: string
  status: "pending" | "running" | "completed" | "failed"
  dry_run: boolean
  row_count: number
  accepted_count?: number
  refused_count?: number
  results?: Array<Record<string, unknown>>
  error?: string | null
  started_at?: string | null
  finished_at?: string | null
}

export interface ConsentRecordImportEnvelope {
  import: ConsentRecordImport
}

export interface ConsentStatusLookup {
  user_id: string
  application_id: string
  overall_status: string
  purposes: Array<{ purpose: string; status: string; granted_at: string | null; granted_by: string | null; expires_at: string | null }>
  subject_ref?: { email?: string; external_id?: string }
}

export interface OverturoConsentRecordsOpts {
  baseUrl: string
  apiToken: string
  fetchFn?: typeof fetch
  timeoutMs?: number
}

export class OverturoConsentRecords {
  private readonly baseUrl: string
  private readonly apiToken: string
  private readonly fetchFn: typeof fetch
  private readonly timeoutMs: number

  constructor(opts: OverturoConsentRecordsOpts) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "")
    this.apiToken = opts.apiToken
    this.fetchFn = opts.fetchFn ?? fetch
    this.timeoutMs = opts.timeoutMs ?? 10_000
  }

  /** Record a consent you captured: creates, binds the subject, commits and freezes the receipt. */
  async create(input: CreateConsentRecordInput): Promise<ConsentRecordEnvelope> {
    if (!input.flow_id) throw new OverturoValidationError("flow_id is required")
    if (!input.subject?.email) throw new OverturoValidationError("subject.email is required")
    if (!input.decisions || Object.keys(input.decisions).length === 0) {
      throw new OverturoValidationError("decisions must name at least one purpose")
    }
    return this.json<ConsentRecordEnvelope>("POST", "/api/v1/consent_records", input)
  }

  /**
   * 201 — commit a capture: your server received the capture token with the
   * form submission and commits it with the application credential. Answers
   * the decision with its record id and channel; a publishable key cannot
   * commit (403 publishable_key_cannot_commit).
   */
  async commitCapture(token: string, input: CommitCaptureInput = {}): Promise<DecisionAuthorizedEnvelope> {
    if (!token) throw new OverturoValidationError("token is required")
    return this.json<DecisionAuthorizedEnvelope>("POST", `/api/v1/decisions/${encodeURIComponent(token)}/authorize`, input)
  }

  async retrieve(recordId: string): Promise<ConsentRecordEnvelope> {
    if (!recordId) throw new OverturoValidationError("recordId is required")
    return this.json<ConsentRecordEnvelope>("GET", `/api/v1/consent_records/${encodeURIComponent(recordId)}`)
  }

  /** Import consents you already hold (at most 5000 rows per batch). */
  async import(input: ImportConsentRecordsInput): Promise<ConsentRecordImportEnvelope> {
    if (!input.flow_id) throw new OverturoValidationError("flow_id is required")
    if (!Array.isArray(input.records) || input.records.length === 0) {
      throw new OverturoValidationError("records must be a non-empty array")
    }
    return this.json<ConsentRecordImportEnvelope>("POST", "/api/v1/consent_records/imports", {
      flow_id: input.flow_id,
      records: input.records,
      dry_run: input.dry_run ?? false,
      send_receipts: input.send_receipts ?? false,
    })
  }

  async retrieveImport(importId: string): Promise<ConsentRecordImportEnvelope> {
    if (!importId) throw new OverturoValidationError("importId is required")
    return this.json<ConsentRecordImportEnvelope>("GET", `/api/v1/consent_records/imports/${encodeURIComponent(importId)}`)
  }

  /** The per-purpose consent status for a subject reference (email or your identifier). */
  async status(applicationId: string, subject: { email?: string; external_id?: string }): Promise<ConsentStatusLookup> {
    if (!applicationId) throw new OverturoValidationError("applicationId is required")
    if (!subject?.email && !subject?.external_id) throw new OverturoValidationError("email or external_id is required")
    const qs = new URLSearchParams()
    if (subject.email) qs.set("subject[email]", subject.email)
    if (subject.external_id) qs.set("subject[external_id]", subject.external_id)
    return this.json<ConsentStatusLookup>(
      "GET",
      `/api/v1/applications/${encodeURIComponent(applicationId)}/consent_status?${qs.toString()}`
    )
  }

  private async json<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const text = await this.request(method, path, body)
    try {
      return JSON.parse(text) as T
    } catch {
      throw new OverturoApiError("Malformed response: not JSON", {})
    }
  }

  private async request(method: "GET" | "POST", path: string, jsonBody?: unknown): Promise<string> {
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
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>
  } catch {
    // non-JSON error body — fall through with the raw text as message
  }
  const error = body["error"]
  const envelope = error !== null && typeof error === "object" ? (error as Record<string, unknown>) : {}
  const message =
    typeof envelope["message"] === "string"
      ? (envelope["message"] as string)
      : typeof error === "string"
        ? error
        : `HTTP ${status}`
  const code = typeof envelope["code"] === "string" ? (envelope["code"] as string) : undefined

  if (status === 401) throw new OverturoUnauthorized(message, { httpStatus: status })
  if (status === 403) throw new OverturoUnauthorized(message, { httpStatus: status, reasonCode: code ?? "forbidden" })
  if (status === 404) throw new OverturoApiError(message, { httpStatus: status, reasonCode: code ?? "not_found" })
  if (status === 409 || status === 422) {
    throw new OverturoValidationError(message, { httpStatus: status, reasonCode: code, detail: envelope })
  }
  if (status === 429) throw new OverturoRateLimited(message)
  if (status >= 500) throw new OverturoServerError(message, { httpStatus: status })
  throw new OverturoApiError(message, { httpStatus: status })
}
