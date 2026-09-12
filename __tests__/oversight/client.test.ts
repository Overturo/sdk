import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OverturoOversight } from "../../src/oversight/client.js"
import { OverturoConfigError } from "../../src/errors.js"

describe("OverturoOversight", () => {
  const BASE = "https://overturo.test"

  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  function discoveryDoc() {
    return {
      issuer: "https://overturo.us",
      oap_protocol_versions_supported: ["1.0"],
      oversight_attestation_endpoint: `${BASE}/api/v1/oap/attestations`,
      oversight_attestation_heartbeat_endpoint: `${BASE}/api/v1/oap/attestations/heartbeat`,
      oversight_escalation_endpoint: `${BASE}/api/v1/oap/escalations`,
      oversight_revocation_endpoint: `${BASE}/api/v1/oap/revocations`,
      oversight_attestation_decisions_supported: ["allow", "deny", "escalate"],
      oversight_attestation_legal_bases_supported: ["consent", "contract", "legitimate_interests"],
      oversight_revocation_scopes_supported: ["attestation", "agent_class", "touchpoint"],
      oversight_revocation_reasons_supported: ["security_incident", "policy_change"],
    }
  }

  function mockFetch(responses: Array<{ body?: unknown; status?: number; headers?: Record<string, string> }>) {
    const spy = vi.spyOn(globalThis, "fetch" as any)
    for (const r of responses) {
      spy.mockResolvedValueOnce(
        new Response(JSON.stringify(r.body ?? {}), {
          status: r.status ?? 200,
          headers: { "content-type": "application/json", ...(r.headers ?? {}) },
        })
      )
    }
    return spy
  }

  describe("create() config validation", () => {
    it("throws OverturoConfigError when baseUrl missing", async () => {
      await expect(
        OverturoOversight.create({ baseUrl: "", token: "t", touchpointId: "tp", heartbeatEnabled: false })
      ).rejects.toBeInstanceOf(OverturoConfigError)
    })

    it("throws OverturoConfigError when token missing", async () => {
      await expect(
        OverturoOversight.create({ baseUrl: BASE, token: "", touchpointId: "tp", heartbeatEnabled: false })
      ).rejects.toBeInstanceOf(OverturoConfigError)
    })

    it("throws OverturoConfigError when touchpointId missing", async () => {
      await expect(
        OverturoOversight.create({ baseUrl: BASE, token: "t", touchpointId: "", heartbeatEnabled: false })
      ).rejects.toBeInstanceOf(OverturoConfigError)
    })

    it("throws OverturoConfigError on non-http baseUrl", async () => {
      await expect(
        OverturoOversight.create({ baseUrl: "file:///etc", token: "t", touchpointId: "tp", heartbeatEnabled: false })
      ).rejects.toBeInstanceOf(OverturoConfigError)
    })
  })

  describe("attest happy path", () => {
    it("posts the attestation body + returns parsed result", async () => {
      const spy = mockFetch([
        { body: discoveryDoc() },
        {
          body: {
            attestation: {
              id: "att_dev_xyz",
              received_at: "2026-06-01T12:00:00.001Z",
              sequence_number: 1,
              decision: "allow",
            },
            receipt: "eyJhbGc.eyJjbGFpbXM.signature",
          },
          status: 201,
        },
      ])

      const client = await OverturoOversight.create({
        baseUrl: BASE,
        token: "tat_dev_xxx",
        touchpointId: "tp_dev_yyy",
        heartbeatEnabled: false,
      })

      const result = await client.attest({
        agentClass: "data_export_agent",
        actionClass: "mcp_tool_call",
        decision: "allow",
        legalBasis: "consent",
        context: { policy_ref: "p" },
        evidenceDigest: "a".repeat(64),
      })

      expect(result.attestationId).toBe("att_dev_xyz")
      expect(result.receipt).toBe("eyJhbGc.eyJjbGFpbXM.signature")
      expect(result.idempotentReplay).toBe(false)

      // Inspect the request body
      const attestCall = spy.mock.calls[1]!
      const body = JSON.parse((attestCall[1] as RequestInit).body as string)
      expect(body.agent_class).toBe("data_export_agent")
      expect(body.action_class).toBe("mcp_tool_call")
      expect(body.decision).toBe("allow")
      expect(body.legal_basis).toBe("consent")
      expect(body.touchpoint_id).toBe("tp_dev_yyy")
      expect(body.sequence_number).toBe(1)
    })

    it("invokes onSequenceUpdate after a successful attest", async () => {
      const onUpdate = vi.fn()
      mockFetch([
        { body: discoveryDoc() },
        {
          body: { attestation: { id: "x", received_at: "t", sequence_number: 5, decision: "allow" }, receipt: null },
          status: 201,
        },
      ])

      const client = await OverturoOversight.create({
        baseUrl: BASE,
        token: "tat_dev_xxx",
        touchpointId: "tp_dev_yyy",
        heartbeatEnabled: false,
        startSequence: 5,
        onSequenceUpdate: onUpdate,
      })

      await client.attest({
        agentClass: "x",
        actionClass: "y",
        decision: "allow",
        legalBasis: "consent",
        context: {},
        evidenceDigest: "a".repeat(64),
      })

      expect(onUpdate).toHaveBeenCalledWith(5)
    })
  })

  describe("attest client-side validation", () => {
    it("rejects an unsupported decision before hitting the wire", async () => {
      mockFetch([{ body: discoveryDoc() }])
      const client = await OverturoOversight.create({
        baseUrl: BASE,
        token: "tat_dev_xxx",
        touchpointId: "tp_dev_yyy",
        heartbeatEnabled: false,
      })

      await expect(
        client.attest({
          agentClass: "x",
          actionClass: "y",
          // @ts-expect-error — testing the runtime guard
          decision: "rogue",
          legalBasis: "consent",
          context: {},
          evidenceDigest: "a".repeat(64),
        })
      ).rejects.toBeInstanceOf(OverturoConfigError)
    })

    it("rejects an unsupported legal_basis before hitting the wire", async () => {
      mockFetch([{ body: discoveryDoc() }])
      const client = await OverturoOversight.create({
        baseUrl: BASE,
        token: "tat_dev_xxx",
        touchpointId: "tp_dev_yyy",
        heartbeatEnabled: false,
      })

      await expect(
        client.attest({
          agentClass: "x",
          actionClass: "y",
          decision: "allow",
          // @ts-expect-error — testing the runtime guard
          legalBasis: "rogue",
          context: {},
          evidenceDigest: "a".repeat(64),
        })
      ).rejects.toBeInstanceOf(OverturoConfigError)
    })

    it("rejects a malformed evidenceDigest before hitting the wire (G10)", async () => {
      mockFetch([{ body: discoveryDoc() }])
      const client = await OverturoOversight.create({
        baseUrl: BASE,
        token: "tat_dev_xxx",
        touchpointId: "tp_dev_yyy",
        heartbeatEnabled: false,
      })

      for (const bad of ["abc", "A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64)]) {
        await expect(
          client.attest({
            agentClass: "x",
            actionClass: "y",
            decision: "allow",
            legalBasis: "consent",
            context: {},
            evidenceDigest: bad,
          })
        ).rejects.toBeInstanceOf(OverturoConfigError)
      }
    })
  })

  describe("revoke", () => {
    it("posts the revocation body + returns parsed result", async () => {
      const spy = mockFetch([
        { body: discoveryDoc() },
        {
          body: {
            revocation: {
              id: "rev_dev_xyz",
              scope: "agent_class",
              affected_attestation_count: 7,
              triggered_at: "2026-06-01T12:00:00.001Z",
              estimated_propagation_complete_at: "2026-06-01T12:00:30.001Z",
            },
          },
          status: 201,
        },
      ])

      const client = await OverturoOversight.create({
        baseUrl: BASE,
        token: "tat_dev_xxx",
        touchpointId: "tp_dev_yyy",
        heartbeatEnabled: false,
      })

      const result = await client.revoke({
        scope: "agent_class",
        agentClass: "data_export_agent",
        reason: "security_incident",
        idempotencyKey: "k1",
      })

      expect(result.revocationId).toBe("rev_dev_xyz")
      expect(result.affectedAttestationCount).toBe(7)

      const revokeCall = spy.mock.calls[1]!
      const headers = (revokeCall[1] as RequestInit).headers as Record<string, string>
      expect(headers["Idempotency-Key"]).toBe("k1")
    })
  })
})
