// Decisions subpackage.
//
// First concrete member (the placeholder that stood here is retired): 189
// pre-flight disclosure discovery. The Python SDK's broader decisions module
// (url_for / poll_status) has no JS analogue yet; those helpers will land in a
// follow-up. This file ships discoverFlowDisclosures + the FlowDisclosures
// shape mirroring config/schemas/decisions/discovery/v1/disclosure_inventory.json.

import { OverturoApiError, OverturoValidationError } from "../errors.js"
import type { HttpClient } from "../http.js"

export type FlowDisclosureMechanism = "explicit" | "informed" | "opt_out" | "documented" | "delegated"

export type FlowDisclosureLegalBasis =
  | "consent"
  | "contract"
  | "legitimate_interest"
  | "legal_obligation"
  | "vital_interest"
  | "public_task"

export type FlowDisclosureButtonMode =
  | "accept"
  | "acknowledge"
  | "authorize"
  | "connect"
  | "continue"
  | "share"
  | "sign_in"
  | "verify"

export interface FlowDisclosurePurpose {
  name: string
  label: string
  description: string | null
  mechanism: FlowDisclosureMechanism
  legal_basis: FlowDisclosureLegalBasis
  required: boolean
  data_labels: string[]
}

export interface FlowDisclosureField {
  name: string
  label: string
  field_type: string
  required: boolean
  section: "input" | "obligation" | "proof"
  completed_by: "principal" | "application" | "both"
}

export interface FlowDisclosureStep {
  key: string
  title: string
}

// Wire shape verbatim (snake_case): this server client does NOT camelCase, so
// the type mirrors the JSON exactly. The envelope is {flow: FlowDisclosures}.
export interface FlowDisclosures {
  schema: string
  flow: { id: string; name: string; version: number; kind: "consent" }
  application: { name: string; primary_color: string | null; logo_url: string | null }
  purposes: FlowDisclosurePurpose[]
  fields: FlowDisclosureField[]
  steps: FlowDisclosureStep[]
  presentation: { button_mode: FlowDisclosureButtonMode; display_label: string }
  outcomes: Array<"granted" | "denied">
  expiry: { consent_duration_days: number | null }
  locale: { requested: "params" | "header" | "default"; resolved: string; fallback: "en" }
  revision: string
}

export interface DiscoverFlowOptions {
  baseUrl: string
  flowId: string
  /**
   * The application's publishable key (pk_live_… / pk_test_…) — an embed-safe,
   * per-application credential. Passed explicitly, not via client config: this
   * endpoint ignores the client's ambient bearer token (the server skips bearer
   * auth for discovery), so the key is the only credential that matters.
   */
  publishableKey: string
  locale?: string
}

/**
 * pre-flight disclosure discovery. GETs
 * /api/v1/decisions/flows/{flowId}/disclosures and returns what the decision
 * screen would present for a consent flow, before any session exists.
 *
 * An unknown / foreign / non-consent flow answers a uniform 404. Note this
 * client's HttpClient maps 404 to `OverturoValidationError` (with
 * `httpStatus === 404`), NOT `OverturoApiError` — catch `OverturoError` (the
 * shared base) or check `httpStatus` to handle "flow not found" portably.
 */
export async function discoverFlowDisclosures(http: HttpClient, opts: DiscoverFlowOptions): Promise<FlowDisclosures> {
  if (!opts.flowId) throw new OverturoValidationError("flowId is required")
  if (!opts.publishableKey) throw new OverturoValidationError("publishableKey is required")

  // Trailing slash on baseUrl must not double the slash (some gateways 404 it).
  const base = opts.baseUrl.replace(/\/+$/, "")
  const qs = opts.locale ? `?locale=${encodeURIComponent(opts.locale)}` : ""
  const url = `${base}/api/v1/decisions/flows/${encodeURIComponent(opts.flowId)}/disclosures${qs}`
  const envelope = await http.get<{ flow: FlowDisclosures }>(url, {
    "X-Publishable-Key": opts.publishableKey,
  })
  // Guard an envelope-less 200 (a proxy/gateway misconfig — the server is
  // fail-closed): surface a typed error instead of returning undefined.
  if (!envelope || typeof envelope !== "object" || !("flow" in envelope)) {
    throw new OverturoApiError("Malformed discovery response: missing 'flow'", {})
  }
  return envelope.flow
}
