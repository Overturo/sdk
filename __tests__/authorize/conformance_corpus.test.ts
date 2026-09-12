// TypeScript round-trip conformance.
//
// For every fixture in ./fixtures/, parses via parseDecision and asserts
// the OverturoDecision-specific fields round-trip unchanged. Cross-SDK
// byte-identity is the contract; passthrough fields are not part of it.
import { describe, test, expect } from "vitest"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseDecision } from "../../src/authorize/decision.js"

const HERE = dirname(fileURLToPath(import.meta.url))
// The shared fixtures when this package sits next to them; the vendored copy otherwise.
const SHARED_FIXTURES = join(HERE, "..", "..", "..", "shared", "conformance", "fixtures")
const FIXTURES_DIR = existsSync(SHARED_FIXTURES) ? SHARED_FIXTURES : join(HERE, "..", "fixtures", "authorize")

const PINNED_FIELDS = [
  "decision",
  "mode",
  "request_id",
  "overturo_decision_schema_version",
  "reason_code",
  "denial_category",
  "cascade_step",
  "failed_bound",
  "decision_latency_ms",
  "chronicle_id",
] as const

const BLOCK_PINNED = ["position", "block_slug", "decision", "latency_ms", "evaluator_class"] as const

const files = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()

describe("cross-SDK conformance corpus", () => {
  for (const name of files) {
    test(name, () => {
      const original = JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8"))
      const parsed = parseDecision(original)
      for (const key of PINNED_FIELDS) {
        const expected = original[key] ?? null
        const actual = (parsed as Record<string, unknown>)[key] ?? null
        expect(actual).toEqual(expected)
      }
      const origInv = (original.block_invocations ?? []) as Record<string, unknown>[]
      const parsedInv = parsed.block_invocations ?? []
      expect(parsedInv).toHaveLength(origInv.length)
      origInv.forEach((o, i) => {
        const p = parsedInv[i] as unknown as Record<string, unknown>
        for (const k of BLOCK_PINNED) {
          expect(p[k]).toEqual(o[k])
        }
      })
    })
  }
})
