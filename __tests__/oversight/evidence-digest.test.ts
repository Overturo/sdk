import { describe, expect, it } from "vitest"
import { evidenceDigest } from "../../src/oversight/evidence-digest.js"
import { canonicalize } from "../../src/canonicalize.js"

describe("evidenceDigest", () => {
  it("returns 64 hex chars (matches the server's regex /\\A[a-f0-9]{64}\\z/)", async () => {
    const digest = await evidenceDigest({ a: 1 }, { b: 2 })
    expect(digest).toMatch(/^[a-f0-9]{64}$/)
  })

  it("is stable across key order (canonicalization)", async () => {
    const a = await evidenceDigest({ a: 1, b: 2 }, { x: 10 })
    const b = await evidenceDigest({ b: 2, a: 1 }, { x: 10 })
    expect(a).toBe(b)
  })

  it("differs when input differs", async () => {
    const a = await evidenceDigest({ a: 1 }, { x: 10 })
    const b = await evidenceDigest({ a: 2 }, { x: 10 })
    expect(a).not.toBe(b)
  })

  it("differs when output differs (input + | + output ordering)", async () => {
    // {a: 1} | {b: 2}  ≠  {b: 2} | {a: 1}  — separator prevents collisions
    const a = await evidenceDigest({ a: 1 }, { b: 2 })
    const b = await evidenceDigest({ b: 2 }, { a: 1 })
    expect(a).not.toBe(b)
  })

  it("handles nested objects + arrays", async () => {
    const digest = await evidenceDigest({ nested: { x: [1, 2, 3] } }, { result: { ok: true } })
    expect(digest).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe("canonicalize", () => {
  it("sorts object keys lexicographically", () => {
    expect(canonicalize({ b: 1, a: 2, c: 3 })).toBe('{"a":2,"b":1,"c":3}')
  })

  it("preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]")
  })

  it("escapes strings via JSON.stringify", () => {
    expect(canonicalize('a"b')).toBe('"a\\"b"')
  })

  it("rejects non-finite numbers", () => {
    expect(() => canonicalize(NaN)).toThrow(/non-finite/)
    expect(() => canonicalize(Infinity)).toThrow(/non-finite/)
  })

  it("handles null + booleans", () => {
    expect(canonicalize(null)).toBe("null")
    expect(canonicalize(true)).toBe("true")
    expect(canonicalize(false)).toBe("false")
  })
})
