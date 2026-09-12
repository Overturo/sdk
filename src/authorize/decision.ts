/**
 * Typed OverturoDecision shape.
 *
 * Mirrors lib/sdk/shared/schemas/overturo_decision_v1.0.0.json.
 *
 * No zod dependency — manual validation at the parser boundary matches
 * the SDK's existing dependency-free posture (parallel to the Python
 * client's dataclasses choice).
 */

export type ModeHint = "conductor" | "oversight" | "hybrid"
export type DecisionKind = "allow" | "deny" | "escalate"
export type BlockDecision = "pass" | "deny" | "escalate" | "dispatch_error"

export interface OverturoBlockInvocation {
  position: number
  block_slug: string
  decision: BlockDecision
  latency_ms: number
  evaluator_class: string
  policy_engine?: string | null
  cache_outcome?: "hit" | null
  reason_code?: string | null
  failed_bound?: string | null
}

export interface OverturoEscalation {
  escalation_id: string
  required_signers: string[]
  approval_ttl_at: string
}

export interface OverturoReceipt {
  jwt: string
  jti: string
  iat: number
  exp: number
}

export interface OverturoDecision {
  decision: DecisionKind
  mode: ModeHint
  request_id: string
  overturo_decision_schema_version: string
  reason_code?: string | null
  denial_category?: string | null
  cascade_step?: number | null
  failed_bound?: string | null
  block_invocations: OverturoBlockInvocation[]
  escalation?: OverturoEscalation | null
  receipt?: OverturoReceipt | null
  decision_latency_ms?: number | null
  chronicle_id?: string | null
  // Passthrough — wire response carries iss, oap_ver, iat, exp, etc.
  [extra: string]: unknown
}

/** Raised when a server response does not conform to the schema. */
export class OverturoDecisionMalformed extends Error {
  constructor(message: string) {
    super(`OverturoDecisionMalformed: ${message}`)
    this.name = "OverturoDecisionMalformed"
  }
}

const ALLOWED_DECISION = new Set<DecisionKind>(["allow", "deny", "escalate"])
const ALLOWED_MODE = new Set<ModeHint>(["conductor", "oversight", "hybrid"])
const ALLOWED_BLOCK_DECISION = new Set<BlockDecision>(["pass", "deny", "escalate", "dispatch_error"])

function require<T = unknown>(obj: Record<string, unknown>, key: string): T {
  if (!(key in obj)) {
    throw new OverturoDecisionMalformed(`missing required field: ${key}`)
  }
  return obj[key] as T
}

function parseBlockInvocation(raw: Record<string, unknown>): OverturoBlockInvocation {
  const decision = raw.decision as BlockDecision
  if (!ALLOWED_BLOCK_DECISION.has(decision)) {
    throw new OverturoDecisionMalformed(`unknown block_invocation.decision: ${String(decision)}`)
  }
  return {
    position: Number(require(raw, "position")),
    block_slug: String(require(raw, "block_slug")),
    decision,
    latency_ms: Number(require(raw, "latency_ms")),
    evaluator_class: String(require(raw, "evaluator_class")),
    policy_engine: (raw.policy_engine as string | null) ?? null,
    cache_outcome: (raw.cache_outcome as "hit" | null) ?? null,
    reason_code: (raw.reason_code as string | null) ?? null,
    failed_bound: (raw.failed_bound as string | null) ?? null,
  }
}

function parseReceipt(payload: Record<string, unknown>): OverturoReceipt | null {
  const raw = payload.receipt
  if (raw === null || raw === undefined) return null
  if (typeof raw === "object") {
    const r = raw as Record<string, unknown>
    return {
      jwt: String(require(r, "jwt")),
      jti: String(require(r, "jti")),
      iat: Number(require(r, "iat")),
      exp: Number(require(r, "exp")),
    }
  }
  if (typeof raw === "string") {
    return {
      jwt: raw,
      jti: String(payload.receipt_jti ?? ""),
      iat: Number(payload.iat ?? 0),
      exp: Number(payload.exp ?? 0),
    }
  }
  throw new OverturoDecisionMalformed(`receipt must be object or string; got ${typeof raw}`)
}

export function parseDecision(payload: unknown): OverturoDecision {
  if (payload === null || typeof payload !== "object") {
    throw new OverturoDecisionMalformed("payload must be an object")
  }
  const obj = payload as Record<string, unknown>

  const decision = require<DecisionKind>(obj, "decision")
  if (!ALLOWED_DECISION.has(decision)) {
    throw new OverturoDecisionMalformed(`unknown decision: ${String(decision)}`)
  }

  const mode = (obj.mode ?? "conductor") as ModeHint
  if (!ALLOWED_MODE.has(mode)) {
    throw new OverturoDecisionMalformed(`unknown mode: ${String(mode)}`)
  }

  const version = String(obj.overturo_decision_schema_version ?? "1.0.0")
  if (!version.startsWith("1.")) {
    throw new OverturoDecisionMalformed(`schema version not 1.x compatible: ${version}`)
  }

  const rawInvocations = (obj.block_invocations ?? []) as unknown[]
  if (!Array.isArray(rawInvocations)) {
    throw new OverturoDecisionMalformed(`block_invocations must be an array; got ${typeof rawInvocations}`)
  }
  const block_invocations = rawInvocations.map((r) => parseBlockInvocation(r as Record<string, unknown>))

  let escalation: OverturoEscalation | null = null
  if (obj.escalation && typeof obj.escalation === "object") {
    const e = obj.escalation as Record<string, unknown>
    escalation = {
      escalation_id: String(require(e, "escalation_id")),
      required_signers: ((e.required_signers as string[]) ?? []).map(String),
      approval_ttl_at: String(require(e, "approval_ttl_at")),
    }
  }

  // Spread `obj` FIRST so passthrough fields (iss, oap_ver, etc.) land,
  // then parsed fields overwrite to ensure types are normalized.
  return {
    ...obj,
    decision,
    mode,
    request_id: String(obj.request_id ?? ""),
    overturo_decision_schema_version: version,
    reason_code: (obj.reason_code as string | null) ?? null,
    denial_category: (obj.denial_category as string | null) ?? null,
    cascade_step: (obj.cascade_step as number | null) ?? null,
    failed_bound: (obj.failed_bound as string | null) ?? null,
    block_invocations,
    escalation,
    receipt: parseReceipt(obj),
    decision_latency_ms: (obj.decision_latency_ms as number | null) ?? null,
    chronicle_id: (obj.chronicle_id as string | null) ?? null,
  }
}
