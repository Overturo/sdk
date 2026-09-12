/**
 * client methods for the authority record endpoints.
 *
 * Wire endpoints:
 *
 *     GET  /api/v1/authorization_receipts/:id   (audit:verify scope)
 *     POST /api/v1/disclosure_receipts          (disclosures:write scope)
 *
 * Plain bearer ApiToken calls — distinct from both the DPoP authorize
 * transport and the TokenManager-driven oversight transport, so this
 * client owns its two fetches.
 *
 * The 404 contract is parity-preserving by design: unknown, foreign,
 * and non-authority ids are indistinguishable — never disambiguated
 * client-side. The two endpoints' 422 shapes differ (the read uses
 * `{error: "<code>", reason}`, the mint uses `{error: "<message>",
 * code}`); both surface as `OverturoValidationError` with `reasonCode`
 * carrying the machine code.
 */
import {
  OverturoApiError,
  OverturoNetworkError,
  OverturoRateLimited,
  OverturoServerError,
  OverturoUnauthorized,
  OverturoValidationError,
} from "../errors.js"

export type ReceiptFlavor = "canonical" | "signed" | "dpv"

export interface OverturoReceiptsOpts {
  baseUrl: string
  apiToken: string
  /** Injectable fetch (tests / custom transport). */
  fetchFn?: typeof fetch
  timeoutMs?: number
}

export interface DisclosureReceiptInput {
  flowId: string
  agentId: string
  /** ISO 8601. */
  disclosedAt: string
  locale?: string
}

export interface MintedDisclosureReceipt {
  record_id: string
  record: Record<string, unknown>
}

export class OverturoReceipts {
  private readonly baseUrl: string
  private readonly apiToken: string
  private readonly fetchFn: typeof fetch
  private readonly timeoutMs: number

  constructor(opts: OverturoReceiptsOpts) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "")
    this.apiToken = opts.apiToken
    this.fetchFn = opts.fetchFn ?? fetch
    this.timeoutMs = opts.timeoutMs ?? 10_000
  }

  /**
   * Fetch a durable authorization record (`audit:verify` scope).
   *
   * `canonical` (default) returns the wrapped document's inner object;
   * `signed` returns the bare envelope — when you intend to verify it,
   * prefer `retrieveSignedAuthorizationReceiptRaw` and hand the raw
   * text to `@overturo/verify`'s `verifyRecord` (JavaScript's
   * JSON.parse collapses number lexemes, and records can carry
   * non-integer numbers); `dpv` returns the JSON-LD document (the body
   * is JSON despite the application/ld+json content type).
   *
   * Typed refusals reject with `OverturoValidationError` whose
   * `reasonCode` is one of `unknown_flavor`, `not_signable`,
   * `dpv_unavailable`.
   */
  async retrieveAuthorizationReceipt(
    recordId: string,
    opts: { flavor?: ReceiptFlavor } = {}
  ): Promise<Record<string, unknown>> {
    const body = await this.request("GET", this.receiptPath(recordId, opts.flavor))
    const parsed = JSON.parse(body) as Record<string, unknown>
    if (opts.flavor === undefined || opts.flavor === "canonical") {
      const inner = parsed["authorization_receipt"]
      if (inner !== null && typeof inner === "object" && !Array.isArray(inner)) {
        return inner as Record<string, unknown>
      }
    }
    return parsed
  }

  /**
   * The signed flavor as RAW response text — the exactness path for
   * verification: pass the returned string straight to `verifyRecord`.
   */
  async retrieveSignedAuthorizationReceiptRaw(recordId: string): Promise<string> {
    return this.request("GET", this.receiptPath(recordId, "signed"))
  }

  /**
   * Mint an operator-declared disclosure receipt (`disclosures:write`
   * scope). Mint-only by design — the operator disclosure log page is
   * the read side. Typed refusals reject with
   * `OverturoValidationError` whose `reasonCode` is one of
   * `agent_not_disclosed`, `invalid_disclosed_at`, `purposes_missing`.
   */
  async createDisclosureReceipt(input: DisclosureReceiptInput): Promise<MintedDisclosureReceipt> {
    const payload: Record<string, string> = {
      flow_id: input.flowId,
      agent_id: input.agentId,
      disclosed_at: input.disclosedAt,
    }
    if (input.locale !== undefined) payload["locale"] = input.locale

    const body = await this.request("POST", "/api/v1/disclosure_receipts", payload)
    const parsed = JSON.parse(body) as Record<string, unknown>
    const inner = parsed["disclosure_receipt"]
    if (inner !== null && typeof inner === "object" && !Array.isArray(inner)) {
      return inner as unknown as MintedDisclosureReceipt
    }
    return parsed as unknown as MintedDisclosureReceipt
  }

  // ── internals ────────────────────────────────────────────────────

  private receiptPath(recordId: string, flavor?: ReceiptFlavor): string {
    const base = `/api/v1/authorization_receipts/${encodeURIComponent(recordId)}`
    return flavor ? `${base}?flavor=${encodeURIComponent(flavor)}` : base
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
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>
    }
  } catch {
    // non-JSON error body — fall through with the raw text as message
  }
  const message = typeof body["error"] === "string" ? (body["error"] as string) : `HTTP ${status}`

  if (status === 401) throw new OverturoUnauthorized(message, { httpStatus: status })
  if (status === 403) {
    throw new OverturoUnauthorized(message, { httpStatus: status, reasonCode: "missing_scope" })
  }
  if (status === 422) {
    const code = body["code"] ?? body["error"]
    throw new OverturoValidationError(message, {
      httpStatus: status,
      reasonCode: typeof code === "string" ? code : undefined,
      detail: body["reason"] ?? body["error"],
    })
  }
  if (status === 429) throw new OverturoRateLimited(message) // its ctor pins httpStatus 429
  if (status >= 500) throw new OverturoServerError(message, { httpStatus: status })
  throw new OverturoApiError(message, { httpStatus: status })
}
