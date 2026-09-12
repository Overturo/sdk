# Reference adapter — NOT a supported Overturo integration

This directory contains a reference implementation of
`OverturoDecisionAdapter` showing how to plug an OPA-style policy
evaluator into the `conductor.policy_gate` external-endpoint contract.

It is **NOT** a supported integration. Specifically:

- The in-memory policy evaluator shipped here is a fixture-driven stub
  that mirrors OPA's `(input, data)` shape with a small subset of Rego
  semantics; it is NOT an OPA WASM runtime. Swap it for the real
  `@open-policy-agent/opa-wasm` package (see [`README.md`](./README.md)
  §OPA swap).
- The HTTP server uses Node's built-in `node:http` for portability —
  no Hono / Express / Fastify dependency. Production deployments
  should use a hardened web framework.
- Authentication, rate limiting, observability, and error handling are
  out of scope for this example. Production deployments must add them.
- No SLA, no semver, no security backporting — this code may be
  rewritten between sub-spec revisions.

Use this directory as a **starting point** for a customer-hosted
decision endpoint, not as a deployable artifact.
