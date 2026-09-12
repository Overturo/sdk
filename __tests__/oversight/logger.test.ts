import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Logger } from "../../src/logger.js"

describe("Logger", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  describe("log levels", () => {
    it("silent suppresses everything", () => {
      const l = new Logger("silent")
      l.warn("hidden")
      l.info("hidden")
      expect(warnSpy).not.toHaveBeenCalled()
      expect(infoSpy).not.toHaveBeenCalled()
    })

    it("warn emits warn but not info/debug", () => {
      const l = new Logger("warn")
      l.warn("visible")
      l.info("hidden")
      expect(warnSpy).toHaveBeenCalledOnce()
      expect(infoSpy).not.toHaveBeenCalled()
    })

    it("info emits warn + info but not debug", () => {
      const l = new Logger("info")
      l.warn("visible")
      l.info("visible")
      expect(warnSpy).toHaveBeenCalledOnce()
      expect(infoSpy).toHaveBeenCalledOnce()
    })
  })

  describe("token redaction", () => {
    it("scrubs bearer tokens in string args", () => {
      const l = new Logger("warn")
      l.warn("about to send request with token tat_dev_secret123abc DONE")
      const args = warnSpy.mock.calls[0]!
      const combined = args.join(" ")
      expect(combined).not.toContain("tat_dev_secret123abc")
      expect(combined).toContain("tat_<redacted>")
    })

    it("scrubs bearer tokens in nested objects", () => {
      const l = new Logger("warn")
      l.warn("payload", { headers: { Authorization: "Bearer tat_dev_secret999xyz" } })
      const args = warnSpy.mock.calls[0]!
      const serialized = JSON.stringify(args)
      expect(serialized).not.toContain("tat_dev_secret999xyz")
      expect(serialized).toContain("tat_<redacted>")
    })

    it("leaves non-string non-token values intact", () => {
      const l = new Logger("warn")
      l.warn("payload", { count: 42, ok: true, items: [1, 2, 3] })
      const args = warnSpy.mock.calls[0]!
      expect(JSON.stringify(args)).toContain("42")
      expect(JSON.stringify(args)).toContain("true")
    })

    it("scrubs urlsafe_base64-shaped tokens with - and _ (B2 regression)", () => {
      const l = new Logger("warn")
      // Real-world shape: TrustedAttesterTokenService uses
      // SecureRandom.urlsafe_base64 which emits `-` and `_` in the
      // suffix. The OLD `[A-Za-z0-9]+` regex truncated at the first
      // `_`/`-`, leaking the high-entropy suffix into logs.
      l.warn("dispatching with token tat_us_LX3c5_Fik5jV-OQbCxYnXBe9_pT0aM-9k DONE")
      const args = warnSpy.mock.calls[0]!
      const combined = args.join(" ")
      expect(combined).not.toContain("LX3c5")
      expect(combined).not.toContain("Fik5jV")
      expect(combined).not.toContain("pT0aM")
      expect(combined).toContain("tat_<redacted>")
    })
  })
})
