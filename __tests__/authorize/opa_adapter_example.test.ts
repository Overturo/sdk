// OPA adapter smoke tests.
import { describe, test, expect, beforeEach } from "vitest"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { InMemoryOpaEvaluator, OpaAdapter } from "../../examples/opa-adapter/opaAdapter.js"

const HERE = dirname(fileURLToPath(import.meta.url))
// Test lives at __tests__/; policy at examples/opa-adapter/policy.json
const POLICY_PATH = join(HERE, "..", "..", "examples", "opa-adapter", "policy.json")

describe("OpaAdapter (reference example)", () => {
  let adapter: OpaAdapter
  beforeEach(() => {
    const evaluator = InMemoryOpaEvaluator.fromFile(POLICY_PATH)
    adapter = new OpaAdapter(evaluator)
  })

  test("read with allowed scope → allow", async () => {
    const d = await adapter.evaluate({
      nonce: "n1",
      action: "read",
      scope: "profile",
    })
    expect(d.decision).toBe("allow")
    expect(d.mode).toBe("conductor")
    expect(d.overturo_decision_schema_version).toBe("1.0.0")
    expect(d.request_id).toMatch(/^opa_\d{8}$/)
  })

  test("write with default scope → allow", async () => {
    const d = await adapter.evaluate({
      nonce: "n2",
      action: "write",
      scope: "data:write",
    })
    expect(d.decision).toBe("allow")
  })

  test("write with high value → deny (action_not_allowed)", async () => {
    const d = await adapter.evaluate({
      nonce: "n3",
      action: "write",
      scope: "data:write",
      value: "1500",
    })
    expect(d.decision).toBe("deny")
    expect(d.reason_code).toBe("action_not_allowed")
    expect(d.cascade_step).toBe(7)
    expect(d.failed_bound).toBe("action_bounds")
  })

  test("read with disallowed scope → deny (scope_not_covered)", async () => {
    const d = await adapter.evaluate({
      nonce: "n4",
      action: "read",
      scope: "secrets",
    })
    expect(d.decision).toBe("deny")
    expect(d.reason_code).toBe("scope_not_covered")
    expect(d.failed_bound).toBe("scope_bounds")
  })

  test("request_id counter increments per call", async () => {
    const a = await adapter.evaluate({ nonce: "n5", action: "read", scope: "profile" })
    const b = await adapter.evaluate({ nonce: "n6", action: "read", scope: "profile" })
    expect(a.request_id).not.toBe(b.request_id)
  })

  test("write with value at the boundary (1000) → allow (not > 1000)", async () => {
    const d = await adapter.evaluate({
      nonce: "n7",
      action: "write",
      scope: "data:write",
      value: "1000",
    })
    expect(d.decision).toBe("allow")
  })
})
