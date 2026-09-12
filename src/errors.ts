/**
 * Unified error tree for @overturo/sdk.
 *
 * Single root `OverturoError` with two sub-trees:
 *
 *   Transport family: OverturoConfigError, OverturoNetworkError,
 *     OverturoApiError, OverturoUnauthorized, OverturoRateLimited,
 *     OverturoServerError, OverturoValidationError, OverturoTimeoutError
 *     (was @overturo/oversight-sdk/errors.ts — preserved sub-tree)
 *
 *   OAP protocol family: OapError + 8 typed subclasses
 *     (was @overturo/authorize/errors.ts — preserved sub-tree, rooted
 *     under OverturoError so a single `instanceof OverturoError` catches
 *     both transport and protocol errors)
 *
 * Field-naming asymmetry is intentional: OverturoError carries
 * camelCase fields (`httpStatus`, `reasonCode`); OapError carries
 * snake_case fields (`http_status`, `reason_code`) because the OAP
 * wire shape uses snake_case across every transport (Python, JS, Go).
 * OapError forwards the relevant snake_case → camelCase translation to
 * the OverturoError constructor so the `instanceof` check is honest.
 */

import type { OapDenialCategory, OapErrorEnvelope, OapReasonCode } from "./authorize/types.js"

// ══════════════════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════════════════

export class OverturoError extends Error {
  override readonly name: string = "OverturoError"
  readonly httpStatus: number | undefined
  readonly reasonCode: string | undefined
  readonly detail: unknown
  readonly requestId: string | undefined

  constructor(
    message: string,
    init: {
      httpStatus?: number
      reasonCode?: string
      detail?: unknown
      requestId?: string
    } = {}
  ) {
    super(message)
    this.httpStatus = init.httpStatus
    this.reasonCode = init.reasonCode
    this.detail = init.detail
    this.requestId = init.requestId
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// ══════════════════════════════════════════════════════════════════════
// Transport family
// (was @overturo/oversight-sdk/errors.ts — preserved sub-tree)
// ══════════════════════════════════════════════════════════════════════

export class OverturoConfigError extends OverturoError {
  override readonly name = "OverturoConfigError"
}

export class OverturoNetworkError extends OverturoError {
  override readonly name = "OverturoNetworkError"
}

export class OverturoTimeoutError extends OverturoError {
  override readonly name = "OverturoTimeoutError"
}

export class OverturoApiError extends OverturoError {
  override readonly name = "OverturoApiError"
}

export class OverturoUnauthorized extends OverturoError {
  override readonly name = "OverturoUnauthorized"
}

export class OverturoRateLimited extends OverturoError {
  override readonly name = "OverturoRateLimited"
  readonly retryAfterSeconds: number | undefined

  constructor(
    message: string,
    init: {
      retryAfterSeconds?: number
      reasonCode?: string
      detail?: unknown
      requestId?: string
    } = {}
  ) {
    super(message, { ...init, httpStatus: 429 })
    this.retryAfterSeconds = init.retryAfterSeconds
  }
}

export class OverturoValidationError extends OverturoError {
  override readonly name = "OverturoValidationError"
}

export class OverturoServerError extends OverturoError {
  override readonly name = "OverturoServerError"
}

// ══════════════════════════════════════════════════════════════════════
// OAP protocol family
// (was @overturo/authorize/errors.ts — preserved sub-tree)
// ══════════════════════════════════════════════════════════════════════

/**
 * Single error class for every OAP-protocol failure. Carrying the
 * `reason_code` as a discriminator (rather than spawning one subclass per
 * code) keeps `switch (err.reason_code)` ergonomic on the caller's side
 * and avoids the JS class-hierarchy tax for a closed enum that's already
 * stable at the wire layer.
 *
 * Three category-level subclasses
 * (OapAuthorizationDenied / OapIntentDenied / OapTrajectoryDenied) so
 * callers can `catch (e: OapIntentDenied)` to branch on retry strategy
 * without inspecting `denial_category` directly.
 */
export class OapError extends OverturoError {
  // Subclasses override this; declare non-readonly so they can.
  override name: string = "OapError"
  readonly reason_code: OapReasonCode
  readonly http_status: number | undefined
  readonly detail: Record<string, unknown> | undefined
  readonly failed_bound: string | undefined
  readonly denial_category: OapDenialCategory | undefined
  readonly cascade_step: number | undefined
  readonly request_id: string | undefined
  readonly negotiable: boolean
  readonly negotiate_url: string | undefined
  readonly documentation_url: string | undefined

  constructor(opts: {
    reason_code: OapReasonCode
    message: string
    http_status?: number
    detail?: Record<string, unknown>
    failed_bound?: string
    denial_category?: OapDenialCategory
    cascade_step?: number
    request_id?: string
    negotiable?: boolean
    negotiate_url?: string
    documentation_url?: string
  }) {
    // forward the camelCase shape to OverturoError so
    // `instanceof OverturoError` + `.httpStatus` work uniformly across
    // both error sub-trees.
    super(opts.message, {
      httpStatus: opts.http_status,
      reasonCode: opts.reason_code,
      detail: opts.detail,
      requestId: opts.request_id,
    })
    this.reason_code = opts.reason_code
    this.http_status = opts.http_status
    this.detail = opts.detail
    this.failed_bound = opts.failed_bound
    this.denial_category = opts.denial_category
    this.cascade_step = opts.cascade_step
    this.request_id = opts.request_id
    this.negotiable = opts.negotiable === true
    this.negotiate_url = opts.negotiate_url
    this.documentation_url = opts.documentation_url
  }

  /**
   * Build an OapError (or category-specific subclass) from a server
   * response. The status carries through so callers can pattern-match
   * on transport-level concerns (429 vs 403) without re-decoding the
   * body.
   *
   * When `denial_category` is present, the returned instance is the
   * matching subclass — `e instanceof OapIntentDenied` works directly.
   */
  static fromEnvelope(envelope: OapErrorEnvelope, status?: number): OapError {
    const err = envelope.error
    const opts = {
      reason_code: err.reason_code,
      message: err.message,
      http_status: status,
      detail: err.detail,
      failed_bound: err.failed_bound,
      denial_category: err.denial_category,
      cascade_step: err.cascade_step,
      request_id: err.request_id,
      negotiable: err.negotiable,
      negotiate_url: err.negotiate_url,
      documentation_url: err.documentation_url,
    }
    // Reason-code dispatch takes precedence over the category
    // dispatch so the most specific subclass wins.
    if (err.reason_code === "sequence_prohibited" || err.reason_code === "sequence_missing_predecessor") {
      return new OapSequenceDenied(opts)
    }
    if (err.reason_code === "escalation_denied") return new OapEscalationDenied(opts)
    if (err.reason_code === "dispatch_error") return new OapDispatchError(opts)
    if (err.reason_code === "wrong_region") return new OapWrongRegion(opts)
    // OapApprovalRequired needs the escalation block from
    // the envelope, so it bypasses the generic opts shape and reads
    // the envelope directly via its own fromEnvelope override.
    if (err.reason_code === "approval_required") {
      return OapApprovalRequired.fromEnvelope(envelope, status)
    }

    switch (err.denial_category) {
      case "authorization_denied":
        return new OapAuthorizationDenied(opts)
      case "intent_denied":
        return new OapIntentDenied(opts)
      case "trajectory_denied":
        return new OapTrajectoryDenied(opts)
      default:
        return new OapError(opts)
    }
  }
}

/**
 * denial_category == "authorization_denied".
 * OAuth/DPoP layer rejected the request. The agent or its developer
 * must fix the credentials; a new principal grant is NOT required.
 */
export class OapAuthorizationDenied extends OapError {
  constructor(opts: ConstructorParameters<typeof OapError>[0]) {
    super(opts)
    this.name = "OapAuthorizationDenied"
  }
}

/**
 * denial_category == "intent_denied".
 * The request fell outside the principal's declared grant bounds.
 * The principal must re-consent for a new grant.
 */
export class OapIntentDenied extends OapError {
  constructor(opts: ConstructorParameters<typeof OapError>[0]) {
    super(opts)
    this.name = "OapIntentDenied"
  }
}

/**
 * denial_category == "trajectory_denied".
 * Execution history (value caps, sequence rules) blocked this
 * specific action. May be transient — retrying later, with a
 * smaller value, or after the rolling window resets, may succeed.
 */
export class OapTrajectoryDenied extends OapError {
  constructor(opts: ConstructorParameters<typeof OapError>[0]) {
    super(opts)
    this.name = "OapTrajectoryDenied"
  }
}

/**
 * sequence_bounds violation
 * (`sequence_prohibited` or `sequence_missing_predecessor`). A
 * trajectory denial with a structural-ordering flavour: the
 * principal's sequence rules block this specific action. Retrying
 * usually does not succeed unless the audit-trail state changes.
 */
export class OapSequenceDenied extends OapTrajectoryDenied {
  constructor(opts: ConstructorParameters<typeof OapError>[0]) {
    super(opts)
    this.name = "OapSequenceDenied"
  }
}

/**
 * synchronous HumanApproval
 * evaluator denied an escalation in-call. v1.0 of the server never
 * raises this; mapping ships so customer code can handle it when 6.1 ships.
 */
export class OapEscalationDenied extends OapError {
  constructor(opts: ConstructorParameters<typeof OapError>[0]) {
    super(opts)
    this.name = "OapEscalationDenied"
  }
}

/**
 * cascade dispatcher wrapped a non-Oap exception.
 * HTTP 500. The underlying error class is in
 * `detail.underlying_error_class`.
 */
export class OapDispatchError extends OapError {
  constructor(opts: ConstructorParameters<typeof OapError>[0]) {
    super(opts)
    this.name = "OapDispatchError"
  }
}

/**
 * caller landed on a non-home region.
 * HTTP 403. Detail includes `home_region` and `home_iss` for
 * cross-region routing.
 */
export class OapWrongRegion extends OapError {
  constructor(opts: ConstructorParameters<typeof OapError>[0]) {
    super(opts)
    this.name = "OapWrongRegion"
  }
}

/**
 * the server returned `decision == "escalate"` from the
 * untyped authorize() path. Raised so callers using the simple
 * surface get a fail-fast signal instead of a silently-incomplete
 * decision they could mistake for an allow.
 *
 * Reason code on the wire: `approval_required`.
 *
 * Field semantics:
 *   decision_url   — full URL the principal opens to approve/deny.
 *                    Includes session_token in its query string —
 *                    **never log**.
 *   session_token  — bearer credential — **never log**.
 *   approval_ttl_at — ISO-8601 string (matches OverturoEscalation).
 *   escalation_id  — prefix_id of the escalation (`esc_dev_…`).
 *   required_signers — array of principal IDs who can approve.
 *
 * The typed authorize_typed() / authorize_with_decomposition() paths
 * do NOT raise this; they return an OverturoDecision with
 * `.decision === "escalate"` and a populated `.escalation`.
 */
export class OapApprovalRequired extends OapError {
  readonly decision_url: string
  readonly session_token: string
  readonly approval_ttl_at: string
  readonly escalation_id: string
  readonly required_signers: readonly string[]

  constructor(
    opts: ConstructorParameters<typeof OapError>[0] & {
      decision_url?: string
      session_token?: string
      approval_ttl_at?: string
      escalation_id?: string
      required_signers?: readonly string[]
    }
  ) {
    super(opts)
    this.name = "OapApprovalRequired"
    this.decision_url = opts.decision_url ?? ""
    this.session_token = opts.session_token ?? ""
    this.approval_ttl_at = opts.approval_ttl_at ?? ""
    this.escalation_id = opts.escalation_id ?? ""
    this.required_signers = Object.freeze([...(opts.required_signers ?? [])])
  }

  static override fromEnvelope(envelope: OapErrorEnvelope, status?: number): OapApprovalRequired {
    const err = envelope.error
    const esc = (err as unknown as { escalation?: Record<string, unknown> }).escalation ?? {}
    return new OapApprovalRequired({
      reason_code: (err.reason_code ?? "approval_required") as OapReasonCode,
      message: err.message ?? "Approval required",
      http_status: status,
      detail: err.detail,
      request_id: err.request_id,
      decision_url: String(esc.decision_url ?? ""),
      session_token: String(esc.session_token ?? ""),
      approval_ttl_at: String(esc.approval_ttl_at ?? ""),
      escalation_id: String(esc.escalation_id ?? ""),
      required_signers: Array.isArray(esc.required_signers) ? (esc.required_signers as string[]) : [],
    })
  }

  // NEVER include session_token or decision_url in toString() —
  // logs and stack traces must be safe to ship to disk.
  override toString(): string {
    return `approval_required: escalation_id=${this.escalation_id}`
  }
}

/** Type guard that lets callers narrow `unknown` from a try/catch. */
export function isOapError(err: unknown): err is OapError {
  return err instanceof OapError
}
