/**
 * main SDK class.
 *
 * Orchestrates Discovery + TokenManager + SequenceManager +
 * HeartbeatManager + HttpClient. `create()` is async because the
 * discovery fetch is.
 */
import { Discovery } from "./discovery.js"
import { OverturoConfigError } from "../errors.js"
import { HeartbeatManager } from "./heartbeat.js"
import { HttpClient } from "../http.js"
import { Logger } from "../logger.js"
import { SequenceManager } from "./sequence.js"
import { TokenManager } from "./token.js"
import type {
  AttestPayload,
  AttestResult,
  EscalatePayload,
  EscalateResult,
  OversightConfig,
  RevokePayload,
  RevokeResult,
} from "./types.js"

const SDK_DEFAULT_OAP_VERSION = "1.0"

export class OverturoOversight {
  private constructor(
    private readonly http: HttpClient,
    private readonly discovery: Discovery,
    private readonly tokens: TokenManager,
    private readonly sequence: SequenceManager,
    private readonly heartbeat: HeartbeatManager | null,
    private readonly logger: Logger,
    private readonly touchpointId: string
  ) {}

  static async create(config: OversightConfig): Promise<OverturoOversight> {
    validateConfig(config)

    const logger = new Logger(config.logLevel ?? "warn")
    const tokens = new TokenManager(config.token, config.tokenProvider)
    const discovery = await Discovery.fetch(config.baseUrl, config.requiredOapVersion ?? SDK_DEFAULT_OAP_VERSION)

    const http = new HttpClient(tokens, logger, {
      maxRetries: config.maxRetries,
      defaultTimeoutMs: config.timeoutMs,
    })

    const sequence = new SequenceManager(config.startSequence ?? 1, config.onSequenceUpdate)

    let heartbeat: HeartbeatManager | null = null
    if (config.heartbeatEnabled !== false) {
      heartbeat = new HeartbeatManager(
        http,
        discovery.endpoints.heartbeat,
        config.heartbeatCadenceSeconds ?? 60,
        logger
      )
      heartbeat.start()
    }

    if (config.startSequence === undefined) {
      logger.warn(
        "Constructed without `startSequence`; SDK will begin at sequence_number=1. " +
          "Pass the persisted value from your durable store to avoid `attestation.gap_detected` on restart."
      )
    }

    return new OverturoOversight(http, discovery, tokens, sequence, heartbeat, logger, config.touchpointId)
  }

  async attest(payload: AttestPayload): Promise<AttestResult> {
    this.assertDecisionSupported(payload.decision)
    this.assertLegalBasisSupported(payload.legalBasis)
    this.assertEvidenceDigestFormat(payload.evidenceDigest)

    const seq = this.sequence.next()
    const body = this.attestationBody(payload, seq)
    const response = await this.http.post<AttestEnvelopeJson>(this.discovery.endpoints.attestation, body)
    await this.sequence.persist(seq)

    return {
      attestationId: response.attestation.id,
      receivedAt: response.attestation.received_at,
      sequenceNumber: response.attestation.sequence_number,
      decision: response.attestation.decision,
      receipt: response.receipt ?? null,
      idempotentReplay: response.attestation.idempotent_replay ?? false,
    }
  }

  /**
   * Two-call shape: submit an `escalate`-decision attestation, then
   * post to the escalation endpoint with the returned attestation_id.
   * Returns the signed approval URL.
   */
  async escalate(payload: EscalatePayload): Promise<EscalateResult> {
    const attestResult = await this.attest({
      ...payload,
      decision: "escalate",
    })

    const escalationBody: Record<string, unknown> = {
      attestation_id: attestResult.attestationId,
      touchpoint_id: this.touchpointId,
      context_class: payload.actionClass,
      proposed_action: payload.proposedAction,
    }
    if (payload.approvalTtlHours !== undefined) {
      escalationBody["approval_ttl_hours"] = payload.approvalTtlHours
    }
    if (payload.requiredSigners) {
      escalationBody["required_signers"] = payload.requiredSigners
    }

    const headers: Record<string, string> = {}
    if (payload.idempotencyKey) {
      headers["Idempotency-Key"] = payload.idempotencyKey
    }

    const response = await this.http.post<EscalationEnvelopeJson>(
      this.discovery.endpoints.escalation,
      escalationBody,
      headers
    )

    return {
      escalationId: response.escalation.id,
      attestationId: attestResult.attestationId,
      approvalUrl: response.escalation.approval_url,
      contextClass: response.escalation.context_class,
      status: response.escalation.status,
      idempotentReplay: response.escalation.idempotent_replay ?? false,
    }
  }

  async revoke(payload: RevokePayload): Promise<RevokeResult> {
    this.assertRevocationScopeSupported(payload.scope)
    this.assertRevocationReasonSupported(payload.reason)

    const body: Record<string, unknown> = {
      scope: payload.scope,
      touchpoint_id: this.touchpointId,
      reason: payload.reason,
    }
    if (payload.agentClass) body["agent_class"] = payload.agentClass
    if (payload.attestationId) body["attestation_id"] = payload.attestationId
    if (payload.reasonDetail) body["reason_detail"] = payload.reasonDetail

    const headers: Record<string, string> = {}
    if (payload.idempotencyKey) {
      headers["Idempotency-Key"] = payload.idempotencyKey
    }

    const response = await this.http.post<RevocationEnvelopeJson>(this.discovery.endpoints.revocation, body, headers)

    return {
      revocationId: response.revocation.id,
      scope: response.revocation.scope,
      affectedAttestationCount: response.revocation.affected_attestation_count,
      triggeredAt: response.revocation.triggered_at,
      estimatedPropagationCompleteAt: response.revocation.estimated_propagation_complete_at,
      idempotentReplay: response.revocation.idempotent_replay ?? false,
    }
  }

  /** Stop the heartbeat timer (if started). Safe to call multiple times. */
  async close(): Promise<void> {
    this.heartbeat?.stop()
  }

  // ── internals ─────────────────────────────────────────────────────

  private attestationBody(payload: AttestPayload, sequenceNumber: number): Record<string, unknown> {
    return {
      attestation_id: payload.attestationId ?? `att-sdk-${generateAttestationId()}`,
      touchpoint_id: this.touchpointId,
      agent_class: payload.agentClass,
      action_class: payload.actionClass,
      decision: payload.decision,
      decided_at: payload.decidedAt ?? new Date().toISOString(),
      sequence_number: sequenceNumber,
      legal_basis: payload.legalBasis,
      evidence_digest: payload.evidenceDigest,
      context: payload.context,
    }
  }

  private assertDecisionSupported(d: string) {
    if (!(this.discovery.supportedDecisions as readonly string[]).includes(d)) {
      throw new OverturoConfigError(
        `Unsupported decision ${JSON.stringify(d)}; server advertises ${JSON.stringify(this.discovery.supportedDecisions)}`
      )
    }
  }

  // G10 — client-side validate the digest format BEFORE hitting the
  // wire. The server's attestation model validates `/^[a-f0-9]{64}$/`;
  // catching it here lets the caller see "did I forget to call
  // `evidenceDigest()`?" instead of a 422 round-trip.
  private assertEvidenceDigestFormat(d: string) {
    if (typeof d !== "string" || !/^[a-f0-9]{64}$/.test(d)) {
      throw new OverturoConfigError(
        `evidenceDigest must be 64 lowercase hex chars (SHA-256). ` +
          `Use the \`evidenceDigest(input, output)\` helper from ` +
          `@overturo/sdk/oversight to compute it correctly.`
      )
    }
  }

  private assertLegalBasisSupported(lb: string) {
    if (!(this.discovery.supportedLegalBases as readonly string[]).includes(lb)) {
      throw new OverturoConfigError(
        `Unsupported legal_basis ${JSON.stringify(lb)}; server advertises ${JSON.stringify(this.discovery.supportedLegalBases)}`
      )
    }
  }

  private assertRevocationScopeSupported(s: string) {
    if (!(this.discovery.supportedRevocationScopes as readonly string[]).includes(s)) {
      throw new OverturoConfigError(
        `Unsupported revocation scope ${JSON.stringify(s)}; server advertises ${JSON.stringify(this.discovery.supportedRevocationScopes)}`
      )
    }
  }

  private assertRevocationReasonSupported(r: string) {
    if (!(this.discovery.supportedRevocationReasons as readonly string[]).includes(r)) {
      throw new OverturoConfigError(
        `Unsupported revocation reason ${JSON.stringify(r)}; server advertises ${JSON.stringify(this.discovery.supportedRevocationReasons)}`
      )
    }
  }
}

function validateConfig(config: OversightConfig): void {
  if (!config.baseUrl) throw new OverturoConfigError("baseUrl is required")
  if (!config.token) throw new OverturoConfigError("token is required")
  if (!config.touchpointId) throw new OverturoConfigError("touchpointId is required")
  if (!config.baseUrl.startsWith("http")) {
    throw new OverturoConfigError(`baseUrl must start with http(s)://; got ${config.baseUrl}`)
  }
}

function generateAttestationId(): string {
  // 64-char prefix-safe random ID (the server's maximum length is 64).
  // crypto.randomUUID() returns 36 chars; prefix `oversight-sdk-` adds 14
  // -> 50 chars total. Safe under the limit + recognisable.
  return `oversight-sdk-${crypto.randomUUID()}`
}

// ── server response shape (snake_case) ─────────────────────────────

interface AttestEnvelopeJson {
  attestation: {
    id: string
    received_at: string
    sequence_number: number
    decision: "allow" | "deny" | "escalate"
    idempotent_replay?: boolean
  }
  receipt: string | null
}

interface EscalationEnvelopeJson {
  escalation: {
    id: string
    status: string
    approval_url: string
    context_class: string
    idempotent_replay?: boolean
  }
}

interface RevocationEnvelopeJson {
  revocation: {
    id: string
    scope: "attestation" | "agent_class" | "touchpoint"
    affected_attestation_count: number
    triggered_at: string
    estimated_propagation_complete_at: string
    idempotent_replay?: boolean
  }
}
