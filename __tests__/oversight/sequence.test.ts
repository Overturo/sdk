import { describe, expect, it, vi } from "vitest"
import { SequenceManager } from "../../src/oversight/sequence.js"

describe("SequenceManager", () => {
  it("starts at 1 by default and increments monotonically", () => {
    const seq = new SequenceManager(1)
    expect(seq.next()).toBe(1)
    expect(seq.next()).toBe(2)
    expect(seq.next()).toBe(3)
  })

  it("respects a non-1 startSequence (resumed from persisted state)", () => {
    const seq = new SequenceManager(42)
    expect(seq.next()).toBe(42)
    expect(seq.next()).toBe(43)
  })

  it("invokes onUpdate with the persisted value", async () => {
    const onUpdate = vi.fn()
    const seq = new SequenceManager(1, onUpdate)
    seq.next()
    await seq.persist(1)
    expect(onUpdate).toHaveBeenCalledWith(1)
  })

  it("awaits async onUpdate (host returns a Promise)", async () => {
    let captured: number | null = null
    const seq = new SequenceManager(1, async (s) => {
      await new Promise((r) => setTimeout(r, 5))
      captured = s
    })
    seq.next()
    await seq.persist(1)
    expect(captured).toBe(1)
  })

  it("rejects non-positive-integer startSequence", () => {
    expect(() => new SequenceManager(0)).toThrow(/positive integer/)
    expect(() => new SequenceManager(-1)).toThrow(/positive integer/)
    expect(() => new SequenceManager(1.5)).toThrow(/positive integer/)
  })

  it("persist() is a no-op when no onUpdate is configured", async () => {
    const seq = new SequenceManager(1)
    await expect(seq.persist(1)).resolves.toBeUndefined()
  })
})
