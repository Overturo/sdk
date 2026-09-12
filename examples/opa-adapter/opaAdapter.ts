/**
 * OPA-style policy adapter — reference implementation.
 *
 * Implements `OverturoDecisionAdapter` against a fixture-driven in-memory
 * policy evaluator that mirrors OPA's `(input, data)` shape with a small
 * subset of Rego semantics. Production deployments swap the
 * `InMemoryOpaEvaluator` for `@open-policy-agent/opa-wasm` reading a
 * compiled .rego bundle (see README §"OPA swap").
 *
 * Reference implementation.
 */

import { readFileSync } from "node:fs"

// SDK type imports. The example ships inside the SDK source tree; in
// production, consumers `import type { OverturoDecision } from "@overturo/sdk"`.
import type { OverturoDecision } from "../../src/authorize/decision.js"
import type { OverturoDecisionAdapter, OverturoAuthorizeRequestPayload } from "../../src/authorize/adapter.js"

interface PolicyRule {
  name: string
  effect: "allow" | "deny"
  input: { action?: string; scope_in?: string[] } | null
  context: { value_gt?: number } | null
}

export interface PolicyEvaluation {
  effect: "allow" | "deny"
  matchedRule: string | null
}

/** In-memory OPA-style policy evaluator. */
export class InMemoryOpaEvaluator {
  constructor(private readonly rules: readonly PolicyRule[]) {}

  static fromFile(path: string): InMemoryOpaEvaluator {
    const data = JSON.parse(readFileSync(path, "utf8")) as { rules?: PolicyRule[] }
    return new InMemoryOpaEvaluator(data.rules ?? [])
  }

  evaluate(input: { action: string; scope: string; value?: string | number | null }): PolicyEvaluation {
    for (const rule of this.rules) {
      if (!this.matchesInput(rule, input)) continue
      if (!this.matchesContext(rule, input)) continue
      return { effect: rule.effect, matchedRule: rule.name }
    }
    return { effect: "deny", matchedRule: null }
  }

  private matchesInput(rule: PolicyRule, input: { action: string; scope: string }): boolean {
    if (!rule.input) return true
    if (rule.input.action !== undefined && rule.input.action !== input.action) {
      return false
    }
    if (rule.input.scope_in !== undefined && !rule.input.scope_in.includes(input.scope)) {
      return false
    }
    return true
  }

  private matchesContext(rule: PolicyRule, input: { value?: string | number | null }): boolean {
    if (!rule.context) return true
    if (rule.context.value_gt !== undefined) {
      const v = typeof input.value === "number" ? input.value : Number(input.value ?? 0)
      if (!Number.isFinite(v) || v <= rule.context.value_gt) return false
    }
    return true
  }
}

/** OverturoDecisionAdapter bridging OAP authorize requests to the
 *  in-memory OPA evaluator. */
export class OpaAdapter implements OverturoDecisionAdapter {
  private counter = 0

  constructor(
    private readonly evaluator: InMemoryOpaEvaluator,
    private readonly requestIdPrefix: string = "opa"
  ) {}

  async evaluate(request: OverturoAuthorizeRequestPayload): Promise<OverturoDecision> {
    const action = (request.action ?? "").toLowerCase()
    const scope = request.scope ?? ""

    const result = this.evaluator.evaluate({
      action,
      scope,
      value: request.value ?? null,
    })

    this.counter += 1
    const request_id = `${this.requestIdPrefix}_${String(this.counter).padStart(8, "0")}`

    if (result.effect === "allow") {
      return {
        decision: "allow",
        mode: "conductor",
        request_id,
        overturo_decision_schema_version: "1.0.0",
        decision_latency_ms: 0.5,
        block_invocations: [],
        reason_code: null,
        denial_category: null,
        cascade_step: null,
        failed_bound: null,
        escalation: null,
        receipt: null,
        chronicle_id: null,
      }
    }
    return {
      decision: "deny",
      mode: "conductor",
      request_id,
      overturo_decision_schema_version: "1.0.0",
      reason_code: action !== "read" ? "action_not_allowed" : "scope_not_covered",
      denial_category: "intent_denied",
      cascade_step: 7,
      failed_bound: action !== "read" ? "action_bounds" : "scope_bounds",
      block_invocations: [],
      escalation: null,
      receipt: null,
      decision_latency_ms: null,
      chronicle_id: null,
    }
  }
}
