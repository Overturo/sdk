# OPA adapter — reference implementation

A reference `OverturoDecisionAdapter` implementation that bridges an
OPA-style policy evaluator to the
policy-gate external-endpoint contract of an Overturo authorization cascade.

**See [`EXAMPLE_DISCLAIMER.md`](./EXAMPLE_DISCLAIMER.md) first** — this
is not a supported integration.

## Files

| File | Purpose |
|---|---|
| `opaAdapter.ts` | `OpaAdapter` + `InMemoryOpaEvaluator` |
| `policy.json` | Example policy fixture (OPA-style rules in JSON) |
| `server.ts` | Stdlib `node:http` server exposing `/evaluate` |
| `../../__tests__/opa_adapter_example.test.ts` | Vitest smoke tests against the fixture policy (lives under the SDK's `__tests__/` so it's CI-gated by `yarn test`) |

## Quick start

```bash
cd lib/sdk/overturo-authorize-js
npx tsx examples/opa-adapter/server.ts
```

Server listens on `http://127.0.0.1:8089/evaluate`. Send a POST with the
OAP authorize request body shape:

```bash
curl -s -X POST http://127.0.0.1:8089/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"nonce":"n1","action":"read","scope":"profile"}'
```

Response is an `OverturoDecision` JSON object (allow / deny shape per
the v1.0.0 schema).

## Wiring into an application

```ruby
# In your composition_manifest:
"blocks" => {
  "policy_gate" => {
    "slug" => "conductor.policy_gate",
    "surface" => "infrastructure",
    "version" => "1.0.0",
    "config" => {
      "fail_open" => false,
      "evaluator_class" => "MyCorp::OpaPolicyAdapter",
      "external_endpoint_url" => "http://localhost:8089/evaluate"
    }
  }
}
```

(The `MyCorp::OpaPolicyAdapter` Ruby class wraps the HTTP client that
calls this endpoint and conforms to the
`BuildingBlocks::Conductor::PolicyGateContract`. Out of scope for this
example.)

## OPA swap

The in-memory `InMemoryOpaEvaluator` mirrors a small subset of OPA's
`(input, data)` shape but is **not** an OPA runtime. To use the real
engine:

```typescript
import {loadPolicy} from "@open-policy-agent/opa-wasm" // npm install @open-policy-agent/opa-wasm

export class OpaBackedEvaluator {
  private constructor(private readonly policy: Awaited<ReturnType<typeof loadPolicy>>) {}

  static async fromBundle(wasmBytes: ArrayBuffer): Promise<OpaBackedEvaluator> {
    const policy = await loadPolicy(wasmBytes)
    return new OpaBackedEvaluator(policy)
  }

  evaluate(input: {action: string; scope: string; value?: unknown}): PolicyEvaluation {
    // OPA's loadPolicy returns an `evaluate(input)` that yields an array
    // of result expressions; the result shape depends on the rego entrypoint.
    const result = this.policy.evaluate(input)
    const allowed = Array.isArray(result) && result[0]?.result === true
    return {effect: allowed ? "allow" : "deny", matchedRule: null}
  }
}
```

Then replace `InMemoryOpaEvaluator` with `OpaBackedEvaluator` in
`server.ts`. The `OpaAdapter` class itself does not change — it only
depends on the `PolicyEvaluation` shape.

The `.rego` source for the example fixture (informal — for reference;
the in-memory evaluator does NOT parse this):

```rego
package overturo

default allow := false

allow if {
  input.action == "read"
  input.scope in {"openid", "profile", "email"}
}

allow if {
  input.action == "write"
  not high_value
}

high_value if input.value > 1000
```

## Tests

```bash
cd lib/sdk/overturo-authorize-js
npx vitest run __tests__/opa_adapter_example.test.ts
```
