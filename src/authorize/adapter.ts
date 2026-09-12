/**
 * Customer decision-engine adapter contract.
 *
 * Customers hosting an HTTP endpoint that conductor.policy_gate calls
 * via its `external_endpoint_url` config implement this interface to
 * bridge their decision engine (Cedar, OPA, in-house) to OverturoDecision.
 */

import type { OverturoDecision } from "./decision.js"

export interface OverturoAuthorizeRequestPayload {
  nonce: string
  action: string
  scope: string
  value?: string
  currency?: string
  counterparty?: string
  context?: Record<string, unknown>
  mode_hint?: "conductor" | "oversight" | "hybrid"
}

export interface OverturoDecisionAdapter {
  evaluate(request: OverturoAuthorizeRequestPayload): Promise<OverturoDecision>
}
