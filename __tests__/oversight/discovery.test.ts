import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Discovery } from "../../src/oversight/discovery.js"
import { OverturoConfigError, OverturoNetworkError } from "../../src/errors.js"

describe("Discovery", () => {
  const BASE = "https://overturo.test"

  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  function discoveryDoc(overrides: Record<string, unknown> = {}) {
    return {
      issuer: "https://overturo.us",
      oap_protocol_versions_supported: ["1.0"],
      oversight_attestation_endpoint: `${BASE}/api/v1/oap/attestations`,
      oversight_attestation_heartbeat_endpoint: `${BASE}/api/v1/oap/attestations/heartbeat`,
      oversight_escalation_endpoint: `${BASE}/api/v1/oap/escalations`,
      oversight_revocation_endpoint: `${BASE}/api/v1/oap/revocations`,
      oversight_attestation_decisions_supported: ["allow", "deny", "escalate"],
      oversight_attestation_legal_bases_supported: ["consent", "contract"],
      oversight_revocation_scopes_supported: ["attestation", "agent_class", "touchpoint"],
      oversight_revocation_reasons_supported: ["security_incident", "policy_change"],
      ...overrides,
    }
  }

  function mockFetch(body: unknown, init: { status?: number } = {}) {
    return vi.spyOn(globalThis, "fetch" as any).mockImplementation(async () => {
      return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json" },
      })
    })
  }

  it("fetches + parses the discovery document", async () => {
    mockFetch(discoveryDoc())
    const d = await Discovery.fetch(BASE)
    expect(d.endpoints.attestation).toBe(`${BASE}/api/v1/oap/attestations`)
    expect(d.endpoints.escalation).toBe(`${BASE}/api/v1/oap/escalations`)
    expect(d.endpoints.heartbeat).toBe(`${BASE}/api/v1/oap/attestations/heartbeat`)
    expect(d.endpoints.revocation).toBe(`${BASE}/api/v1/oap/revocations`)
  })

  it("caches closed-enum vocabularies for client-side validation", async () => {
    mockFetch(discoveryDoc())
    const d = await Discovery.fetch(BASE)
    expect(d.supportedDecisions).toEqual(["allow", "deny", "escalate"])
    expect(d.supportedLegalBases).toEqual(["consent", "contract"])
  })

  it("throws OverturoConfigError when required OAP version is missing", async () => {
    mockFetch(discoveryDoc({ oap_protocol_versions_supported: ["2.0"] }))
    await expect(Discovery.fetch(BASE, "1.0")).rejects.toBeInstanceOf(OverturoConfigError)
  })

  it("throws OverturoConfigError when a required endpoint is missing", async () => {
    const doc = discoveryDoc()
    delete (doc as Record<string, unknown>).oversight_attestation_endpoint
    mockFetch(doc)
    await expect(Discovery.fetch(BASE)).rejects.toBeInstanceOf(OverturoConfigError)
  })

  it("throws OverturoNetworkError on non-2xx response", async () => {
    mockFetch({}, { status: 503 })
    await expect(Discovery.fetch(BASE)).rejects.toBeInstanceOf(OverturoNetworkError)
  })

  it("throws OverturoNetworkError on network failure", async () => {
    vi.spyOn(globalThis, "fetch" as any).mockRejectedValue(new TypeError("ECONNREFUSED"))
    await expect(Discovery.fetch(BASE)).rejects.toBeInstanceOf(OverturoNetworkError)
  })
})
