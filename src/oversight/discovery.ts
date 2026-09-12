/**
 * discovery-document client.
 *
 * Fetches `/.well-known/openid-configuration` on `create()` and
 * caches:
 *   - `oversight_*_endpoint` URLs
 *   - `oap_protocol_versions_supported` (asserted against SDK version)
 *   - Closed-enum vocabularies (for client-side validation)
 *
 * TTL: 1 hour. Refresh via `Discovery.refresh()` if a long-running
 * SDK instance needs to pick up server-side changes.
 */
import { OverturoConfigError, OverturoNetworkError } from "../errors.js"
import type {
  Decision,
  DiscoveryDoc,
  LegalBasis,
  ResolvedEndpoints,
  RevocationReason,
  RevocationScope,
} from "./types.js"

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

export class Discovery {
  private constructor(
    public readonly endpoints: ResolvedEndpoints,
    public readonly supportedDecisions: readonly Decision[],
    public readonly supportedLegalBases: readonly LegalBasis[],
    public readonly supportedRevocationScopes: readonly RevocationScope[],
    public readonly supportedRevocationReasons: readonly RevocationReason[],
    public readonly supportedOapVersions: readonly string[],
    private readonly fetchedAt: number,
    private readonly baseUrl: string
  ) {}

  /** Fetch + parse the discovery doc; assert OAP version compatibility. */
  static async fetch(baseUrl: string, requiredOapVersion = "1.0"): Promise<Discovery> {
    const url = joinUrl(baseUrl, "/.well-known/openid-configuration")

    let response: Response
    try {
      response = await fetch(url)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      throw new OverturoNetworkError(`Discovery fetch failed: ${message}`)
    }

    if (!response.ok) {
      throw new OverturoNetworkError(`Discovery fetch returned HTTP ${response.status}`)
    }

    const doc = (await response.json()) as DiscoveryDoc

    const supportedVersions = doc.oap_protocol_versions_supported ?? []
    if (!supportedVersions.includes(requiredOapVersion)) {
      throw new OverturoConfigError(
        `Server does NOT support OAP version ${requiredOapVersion}; advertised: ${JSON.stringify(supportedVersions)}`
      )
    }

    const endpoints: ResolvedEndpoints = {
      attestation: assertUrl(doc.oversight_attestation_endpoint, "oversight_attestation_endpoint"),
      heartbeat: assertUrl(doc.oversight_attestation_heartbeat_endpoint, "oversight_attestation_heartbeat_endpoint"),
      escalation: assertUrl(doc.oversight_escalation_endpoint, "oversight_escalation_endpoint"),
      revocation: assertUrl(doc.oversight_revocation_endpoint, "oversight_revocation_endpoint"),
    }

    return new Discovery(
      endpoints,
      doc.oversight_attestation_decisions_supported ?? ["allow", "deny", "escalate"],
      doc.oversight_attestation_legal_bases_supported ?? [
        "consent",
        "contract",
        "legal_obligation",
        "vital_interests",
        "public_task",
        "legitimate_interests",
      ],
      doc.oversight_revocation_scopes_supported ?? ["attestation", "agent_class", "touchpoint"],
      doc.oversight_revocation_reasons_supported ?? [
        "compliance_failure",
        "security_incident",
        "data_subject_request",
        "policy_change",
        "other",
      ],
      supportedVersions,
      Date.now(),
      baseUrl
    )
  }

  /** Re-fetch + return a new Discovery instance. */
  async refresh(): Promise<Discovery> {
    return Discovery.fetch(this.baseUrl)
  }

  get isStale(): boolean {
    return Date.now() - this.fetchedAt > DEFAULT_CACHE_TTL_MS
  }

  /** Throws when the SDK's required OAP version isn't advertised. */
  assertSupportedOapVersion(version: string): void {
    if (!this.supportedOapVersions.includes(version)) {
      throw new OverturoConfigError(
        `Server does NOT support OAP version ${version}; advertised: ${JSON.stringify(this.supportedOapVersions)}`
      )
    }
  }
}

function assertUrl(value: string | undefined, key: string): string {
  if (!value) {
    throw new OverturoConfigError(
      `Discovery document missing required field: ${key}. Does the server support oversight?`
    )
  }
  return value
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + path
}
