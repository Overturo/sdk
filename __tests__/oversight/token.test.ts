import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { TokenManager } from "../../src/oversight/token.js"

describe("TokenManager", () => {
  const originalEnv = process.env.OVERTURO_ATTESTER_TOKEN

  beforeEach(() => {
    delete process.env.OVERTURO_ATTESTER_TOKEN
  })

  afterEach(() => {
    if (originalEnv) process.env.OVERTURO_ATTESTER_TOKEN = originalEnv
    else delete process.env.OVERTURO_ATTESTER_TOKEN
  })

  it("returns the initial token from .current()", () => {
    const t = new TokenManager("tat_dev_initial")
    expect(t.current()).toBe("tat_dev_initial")
  })

  it("refresh() returns true + updates current() when env-var changed", async () => {
    const t = new TokenManager("tat_dev_initial")
    process.env.OVERTURO_ATTESTER_TOKEN = "tat_dev_rotated"

    const rotated = await t.refresh()

    expect(rotated).toBe(true)
    expect(t.current()).toBe("tat_dev_rotated")
  })

  it("refresh() returns false when env-var matches current token", async () => {
    const t = new TokenManager("tat_dev_same")
    process.env.OVERTURO_ATTESTER_TOKEN = "tat_dev_same"

    const rotated = await t.refresh()

    expect(rotated).toBe(false)
    expect(t.current()).toBe("tat_dev_same")
  })

  it("refresh() returns false when no env-var + no tokenProvider", async () => {
    const t = new TokenManager("tat_dev_initial")
    expect(await t.refresh()).toBe(false)
    expect(t.current()).toBe("tat_dev_initial")
  })

  it("prefers tokenProvider over env-var", async () => {
    process.env.OVERTURO_ATTESTER_TOKEN = "tat_dev_env"
    const t = new TokenManager("tat_dev_initial", async () => "tat_dev_provider")

    const rotated = await t.refresh()

    expect(rotated).toBe(true)
    expect(t.current()).toBe("tat_dev_provider")
  })

  it("tokenProvider may be sync", async () => {
    const t = new TokenManager("tat_dev_initial", () => "tat_dev_sync")
    await t.refresh()
    expect(t.current()).toBe("tat_dev_sync")
  })
})
