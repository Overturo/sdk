// parseDecision unit tests.
import { describe, test, expect } from "vitest"
import { parseDecision, OverturoDecisionMalformed, type OverturoDecision } from "../../src/authorize/decision.js"

const baseAllow = {
  decision: "allow" as const,
  mode: "conductor" as const,
  request_id: "req_abc",
  overturo_decision_schema_version: "1.0.0",
}

describe("parseDecision", () => {
  test("happy path: minimal allow", () => {
    const d = parseDecision(baseAllow)
    expect(d.decision).toBe("allow")
    expect(d.mode).toBe("conductor")
    expect(d.block_invocations).toEqual([])
  })

  test("preserves passthrough fields (iss, oap_ver)", () => {
    const d = parseDecision({ ...baseAllow, iss: "https://eu.example.com", oap_ver: "1.0" }) as OverturoDecision & {
      iss: string
      oap_ver: string
    }
    expect(d.iss).toBe("https://eu.example.com")
    expect(d.oap_ver).toBe("1.0")
  })

  test("parses a block_invocations array", () => {
    const d = parseDecision({
      ...baseAllow,
      block_invocations: [
        {
          position: 7,
          block_slug: "conductor.policy_gate",
          decision: "pass",
          latency_ms: 1.5,
          evaluator_class: "BuiltinEvaluator",
        },
        {
          position: 10,
          block_slug: "conductor.budget_governor",
          decision: "pass",
          latency_ms: 2.0,
          evaluator_class: "BuiltinEvaluator",
          cache_outcome: "hit",
        },
      ],
    })
    expect(d.block_invocations).toHaveLength(2)
    expect(d.block_invocations[0].position).toBe(7)
    expect(d.block_invocations[1].cache_outcome).toBe("hit")
  })

  test("parses escalation object", () => {
    const d = parseDecision({
      ...baseAllow,
      decision: "escalate",
      escalation: {
        escalation_id: "esc_abc",
        required_signers: ["principal"],
        approval_ttl_at: "2026-12-31T00:00:00Z",
      },
    })
    expect(d.escalation?.escalation_id).toBe("esc_abc")
    expect(d.escalation?.required_signers).toEqual(["principal"])
  })

  test("parses receipt as string", () => {
    const d = parseDecision({
      ...baseAllow,
      receipt: "eyJ.AAA.BBB",
      receipt_jti: "jti_1",
      iat: 1700000000,
      exp: 1700003600,
    })
    expect(d.receipt?.jwt).toBe("eyJ.AAA.BBB")
    expect(d.receipt?.jti).toBe("jti_1")
  })

  test("parses receipt as object", () => {
    const d = parseDecision({
      ...baseAllow,
      receipt: { jwt: "eyJ.AAA.BBB", jti: "jti_2", iat: 1700000000, exp: 1700003600 },
    })
    expect(d.receipt?.jti).toBe("jti_2")
  })

  describe("malformed inputs", () => {
    test("rejects non-object payload", () => {
      expect(() => parseDecision("hello")).toThrow(OverturoDecisionMalformed)
      expect(() => parseDecision(null)).toThrow(OverturoDecisionMalformed)
    })

    test("rejects missing decision", () => {
      const { decision: _omit, ...withoutDecision } = baseAllow
      expect(() => parseDecision(withoutDecision)).toThrow(/missing required field: decision/)
    })

    test("rejects unknown decision value", () => {
      expect(() => parseDecision({ ...baseAllow, decision: "maybe" })).toThrow(/unknown decision: maybe/)
    })

    test("rejects unknown mode", () => {
      expect(() => parseDecision({ ...baseAllow, mode: "trust" })).toThrow(/unknown mode: trust/)
    })

    test("rejects v2.x schema version", () => {
      expect(() => parseDecision({ ...baseAllow, overturo_decision_schema_version: "2.0.0" })).toThrow(
        /not 1\.x compatible/
      )
    })

    test("rejects unknown block_invocation decision", () => {
      expect(() =>
        parseDecision({
          ...baseAllow,
          block_invocations: [
            { position: 7, block_slug: "x", decision: "ALLOWED", latency_ms: 1, evaluator_class: "Y" },
          ],
        })
      ).toThrow(/unknown block_invocation.decision: ALLOWED/)
    })

    test("rejects non-array block_invocations", () => {
      expect(() => parseDecision({ ...baseAllow, block_invocations: "lots" })).toThrow(
        /block_invocations must be an array/
      )
    })

    test("rejects receipt of wrong type", () => {
      expect(() => parseDecision({ ...baseAllow, receipt: 42 })).toThrow(/receipt must be object or string/)
    })
  })
})
