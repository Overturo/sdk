/**
 * public type definitions.
 *
 * Closed-enum vocabularies mirror server-side constants:
 *   - Decision           ← Oap::Attestation::DECISIONS
 *   - LegalBasis         ← Oap::Attestation::LEGAL_BASES
 *   - RevocationScope    ← Oap::Revocation::SCOPES
 *   - RevocationReason   ← Oap::Revocation::REASONS
 */

export type Decision = "allow" | "deny" | "escalate"

export type LegalBasis =
  | "consent"
  | "contract"
  | "legal_obligation"
  | "vital_interests"
  | "public_task"
  | "legitimate_interests"

export type RevocationScope = "attestation" | "agent_class" | "touchpoint"

export type RevocationReason =
  | "compliance_failure"
  | "security_incident"
  | "data_subject_request"
  | "policy_change"
  | "other"

/** Constructor / `create()` configuration. */
export interface OversightConfig {
  /** Base URL of the Overturo region (e.g., `https://overturo.us`). */
  baseUrl: string

  /** TrustedAttester bearer token (`tat_<region>_<base32>`). */
  token: string

  /** Application prefix-id (`tp_<region>_<base32>`). */
  touchpointId: string

  /** Optional async token provider. When omitted, SDK reads from `OVERTURO_ATTESTER_TOKEN` env on rotation. */
  tokenProvider?: () => string | Promise<string>

  /** Defaults to `true`. */
  heartbeatEnabled?: boolean

  /** Defaults to 60. */
  heartbeatCadenceSeconds?: number

  /** Defaults to 1. Pass the value from the host app's durable store. */
  startSequence?: number

  /** Called after every successful attestation with the new sequence value. */
  onSequenceUpdate?: (seq: number) => void | Promise<void>

  /** Max retries on 429/5xx. Defaults to 3. */
  maxRetries?: number

  /** Per-request timeout (ms). Defaults to 30 000. */
  timeoutMs?: number

  /** Defaults to "console". `silent` suppresses all SDK logs. */
  logLevel?: "silent" | "warn" | "info" | "debug"

  /**
   * OAP wire-protocol version the SDK declares + asserts against the
   * server's `oap_protocol_versions_supported`. Defaults to "1.0".
   * Override when targeting a different version (e.g., pinning to a
   * deprecation window).
   */
  requiredOapVersion?: string
}

export interface AttestPayload {
  agentClass: string
  actionClass: string
  decision: Decision
  legalBasis: LegalBasis
  context: Record<string, unknown>
  evidenceDigest: string
  /** Optional override; SDK auto-generates when absent. */
  attestationId?: string
  /** Optional override; SDK uses `Date.now()` when absent. */
  decidedAt?: string
}

export interface AttestResult {
  attestationId: string
  receivedAt: string
  sequenceNumber: number
  decision: Decision
  receipt: string | null
  idempotentReplay: boolean
}

export interface EscalatePayload extends Omit<AttestPayload, "decision"> {
  proposedAction: Record<string, unknown>
  approvalTtlHours?: number
  requiredSigners?: string[]
  idempotencyKey?: string
}

export interface EscalateResult {
  escalationId: string
  attestationId: string
  approvalUrl: string
  contextClass: string
  status: string
  idempotentReplay: boolean
}

export interface RevokePayload {
  scope: RevocationScope
  agentClass?: string
  attestationId?: string
  reason: RevocationReason
  reasonDetail?: string
  idempotencyKey?: string
}

export interface RevokeResult {
  revocationId: string
  scope: RevocationScope
  affectedAttestationCount: number
  triggeredAt: string
  estimatedPropagationCompleteAt: string
  idempotentReplay: boolean
}

/** Subset of the discovery doc the SDK consumes. */
export interface DiscoveryDoc {
  oap_protocol_versions_supported?: string[]
  oversight_attestation_endpoint?: string
  oversight_attestation_heartbeat_endpoint?: string
  oversight_escalation_endpoint?: string
  oversight_revocation_endpoint?: string
  iss_roles_supported?: string[]
  modes_supported?: string[]
  oversight_attestation_decisions_supported?: Decision[]
  oversight_attestation_legal_bases_supported?: LegalBasis[]
  oversight_revocation_scopes_supported?: RevocationScope[]
  oversight_revocation_reasons_supported?: RevocationReason[]
}

/** Resolved endpoint URLs after discovery. */
export interface ResolvedEndpoints {
  attestation: string
  heartbeat: string
  escalation: string
  revocation: string
}
