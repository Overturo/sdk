/**
 * OAP v1.0 protocol types.
 *
 * Hand-mirrored from `app/services/oap/*` shapes. When the wire format
 * evolves these MUST be updated in lockstep — the SDK is the contract
 * boundary that third-party integrators rely on.
 */

export const OAP_VERSION = "1.0" as const
export type OapVersion = typeof OAP_VERSION

/** Authorize request body — agent → POST /api/v1/grants/:id/authorize. */
export interface AuthorizeRequest {
  /** UUID per attempt; replay-protected at the platform. */
  nonce: string
  /** Action token from the grant's `action_bounds.allowed_actions`. */
  action: string
  /** Scope token from the grant's `scope_bounds.allowed_scopes`. */
  scope: string
  /** Decimal-as-string when the action carries monetary value. */
  value?: string
  /** ISO 4217 fiat code or stablecoin code (USD, EUR, USDC, …). */
  currency?: string
  /** Counterparty identifier (DID / HTTPS URL / URN). Becomes `aud`. */
  counterparty?: string
  /** Free-form context — never persisted, hashed to `context_hash`. */
  context?: Record<string, unknown>
  /**
   * the action's target jurisdiction (an ISO country). Declares
   * where the action is headed so the platform can enforce a jurisdiction
   * bound; a request without it is unconstrained. Mapped into the authorize
   * context before sending.
   */
  jurisdiction?: string
}

/** Allow decision — receipt issued. */
export interface AuthorizeAllowResponse {
  decision: "allow"
  /** Compact JWS oap+jwt receipt. Hand to the counterparty's /verify. */
  receipt: string
  /** Same `jti` claim that's inside the receipt body. */
  jti: string
  /** Unix seconds; receipts are short-lived (60s by default). */
  exp: number
  /** Pointer for the audit chain entry recording this authorize call. */
  chronicle_id: string
  oap_ver: OapVersion
}

/** Escalate decision — principal approval required. */
export interface AuthorizeEscalateResponse {
  decision: "escalate"
  escalation_id: string
  /** Threshold that triggered the escalation. */
  threshold: Record<string, unknown>
  approval_ttl_at: string
  oap_ver: OapVersion
}

export type AuthorizeResponse = AuthorizeAllowResponse | AuthorizeEscalateResponse

/** Decoded receipt claims. Matches the wire shape. */
export interface ReceiptClaims {
  iss: string
  sub?: string
  aud: string
  iat: number
  exp: number
  jti: string
  oap_ver: string
  grant_id: string
  principal_did?: string
  agent_did?: string
  action: string
  scope: string
  value?: string
  currency?: string
  context_hash: string
  chronicle_id: string
  single_use: true
  [k: string]: unknown
}

export interface ReceiptHeader {
  alg: "EdDSA"
  typ: "oap+jwt"
  kid: string
}

/** Result of offline verify (signature + structural checks). */
export interface OfflineVerifyResult {
  valid: boolean
  claims?: ReceiptClaims
  reason_code?: OapReasonCode
}

/** Closed enumeration of OAP error reason codes (spec Appendix B). */
export type OapReasonCode =
  | "malformed"
  | "invalid_alg"
  | "invalid_typ"
  | "invalid_aud"
  | "invalid_iss"
  | "invalid_version"
  | "expired"
  | "not_yet_valid"
  | "bad_signature"
  | "unknown_kid"
  | "auth_missing"
  | "auth_invalid"
  | "dpop_invalid"
  | "dpop_replay"
  | "scope_not_covered"
  | "action_not_allowed"
  | "value_exceeds_tx_max"
  | "value_exceeds_day_max"
  | "value_exceeds_month_max"
  | "currency_mismatch"
  | "outside_time_bounds"
  | "counterparty_trust_too_low"
  | "counterparty_kyc_missing"
  | "counterparty_vouches_insufficient"
  | "grant_pending"
  | "grant_paused"
  | "grant_revoked"
  | "grant_expired"
  | "wrong_region"
  | "jurisdiction_not_permitted"
  | "approval_required"
  | "nonce_replay"
  | "validation_failed"
  | "not_found"
  | "rate_limited"
  | "rate_limited_global"
  | "internal_error"
  | "feature_disabled"
  // sequence_bounds (cascade step 13)
  | "sequence_prohibited"
  | "sequence_missing_predecessor"
  // Conductor-cascade additions.
  | "escalation_denied"
  | "dispatch_error"
  | "chronicle_stream_prefix_invalid"

/**
 * OAP denial category. Cascade-relevant errors carry
 * exactly one value; non-cascade errors (validation, conflict, internal)
 * omit the field.
 */
export type OapDenialCategory = "authorization_denied" | "intent_denied" | "trajectory_denied"

/** OAP error envelope shape rendered by the server. */
export interface OapErrorEnvelope {
  error: {
    reason_code: OapReasonCode
    message: string
    detail?: Record<string, unknown>
    failed_bound?: string
    /** present on cascade-relevant denials only. */
    denial_category?: OapDenialCategory
    /**
     * 1..15 cascade position. Rate-limit-gated server-side
     * after THRESHOLD denials per (grant, agent) in WINDOW seconds,
     * so SDK code MUST treat absence as opaque and branch on `denial_category`
     * for retry strategy.
     */
    cascade_step?: number
    documentation_url?: string
    request_id?: string
    negotiable?: boolean
    negotiate_url?: string
    oap_ver: string
  }
}

/** Public key material the offline verifier needs to validate a receipt. */
export interface JwksKey {
  kid: string
  kty: "OKP"
  crv: "Ed25519"
  /** Base64url-encoded raw Ed25519 public key (32 bytes). */
  x: string
}
