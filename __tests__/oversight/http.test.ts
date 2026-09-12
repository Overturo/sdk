import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  OverturoRateLimited,
  OverturoServerError,
  OverturoUnauthorized,
  OverturoValidationError,
} from "../../src/errors.js"
import { HttpClient } from "../../src/http.js"
import { Logger } from "../../src/logger.js"
import { TokenManager } from "../../src/oversight/token.js"

describe("HttpClient", () => {
  const URL = "https://overturo.test/api/v1/oap/attestations"
  const logger = new Logger("silent")

  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: new Headers(init.headers ?? { "content-type": "application/json" }),
    })
  }

  function mockOnce(response: Response) {
    return vi.spyOn(globalThis, "fetch" as any).mockResolvedValueOnce(response)
  }

  describe("happy path", () => {
    it("posts JSON + parses the response", async () => {
      const tokens = new TokenManager("tat_dev_initial")
      const http = new HttpClient(tokens, logger)
      mockOnce(jsonResponse({ ok: true }, { status: 201 }))

      const result = await http.post<{ ok: boolean }>(URL, { hello: "world" })
      expect(result.ok).toBe(true)
    })

    it("sends Authorization: Bearer header sourced from TokenManager", async () => {
      const tokens = new TokenManager("tat_dev_initial")
      const http = new HttpClient(tokens, logger)
      const fetchSpy = mockOnce(jsonResponse({ ok: true }, { status: 201 }))

      await http.post(URL, {})

      const args = fetchSpy.mock.calls[0]!
      const init = args[1] as RequestInit
      expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tat_dev_initial")
    })
  })

  describe("error classification", () => {
    it("maps 401 to OverturoUnauthorized after refresh yields no new token", async () => {
      const tokens = new TokenManager("tat_dev_initial")
      const http = new HttpClient(tokens, logger, { maxRetries: 0 })
      mockOnce(
        jsonResponse(
          { error: { reason_code: "trusted_attester_unauthenticated", message: "bad token" } },
          { status: 401 }
        )
      )

      await expect(http.post(URL, {})).rejects.toBeInstanceOf(OverturoUnauthorized)
    })

    it("maps 422 to OverturoValidationError", async () => {
      const tokens = new TokenManager("tat_dev_initial")
      const http = new HttpClient(tokens, logger)
      mockOnce(jsonResponse({ error: { reason_code: "validation_failed", message: "bad scope" } }, { status: 422 }))

      await expect(http.post(URL, {})).rejects.toBeInstanceOf(OverturoValidationError)
    })

    it("maps 500 to OverturoServerError after retries exhausted", async () => {
      const tokens = new TokenManager("tat_dev_initial")
      const http = new HttpClient(tokens, logger, { maxRetries: 0 })
      mockOnce(jsonResponse({ error: { reason_code: "internal_error", message: "boom" } }, { status: 500 }))

      await expect(http.post(URL, {})).rejects.toBeInstanceOf(OverturoServerError)
    })
  })

  describe("retry behavior", () => {
    it("retries on 429 + honors Retry-After header (in seconds)", async () => {
      const tokens = new TokenManager("tat_dev_initial")
      const http = new HttpClient(tokens, logger, { maxRetries: 2 })

      const fetchSpy = vi
        .spyOn(globalThis, "fetch" as any)
        .mockResolvedValueOnce(
          jsonResponse(
            { error: { reason_code: "rate_limited" } },
            {
              status: 429,
              headers: { "retry-after": "0", "content-type": "application/json" },
            }
          )
        )
        .mockResolvedValueOnce(jsonResponse({ ok: true }, { status: 201 }))

      const result = await http.post<{ ok: boolean }>(URL, {})
      expect(result.ok).toBe(true)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it("raises OverturoRateLimited after maxRetries exhausted", async () => {
      const tokens = new TokenManager("tat_dev_initial")
      const http = new HttpClient(tokens, logger, { maxRetries: 1 })

      vi.spyOn(globalThis, "fetch" as any).mockResolvedValue(
        jsonResponse(
          { error: { reason_code: "rate_limited", detail: { retry_after_seconds: 5 } } },
          {
            status: 429,
            headers: { "retry-after": "0", "content-type": "application/json" },
          }
        )
      )

      const err = await http.post(URL, {}).catch((e) => e)
      expect(err).toBeInstanceOf(OverturoRateLimited)
      expect((err as OverturoRateLimited).retryAfterSeconds).toBeUndefined()
      // Note: retryAfterSeconds populated only when Retry-After header carries non-zero seconds
    })

    it("retries 5xx + succeeds on second attempt", async () => {
      const tokens = new TokenManager("tat_dev_initial")
      const http = new HttpClient(tokens, logger, { maxRetries: 2 })

      vi.spyOn(globalThis, "fetch" as any)
        .mockResolvedValueOnce(jsonResponse({ error: { reason_code: "internal_error" } }, { status: 503 }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }, { status: 201 }))

      const result = await http.post<{ ok: boolean }>(URL, {})
      expect(result.ok).toBe(true)
    }, 10_000)
  })

  describe("token rotation", () => {
    it("refreshes token on 401 + retries with new token", async () => {
      const originalEnv = process.env.OVERTURO_ATTESTER_TOKEN
      process.env.OVERTURO_ATTESTER_TOKEN = "tat_dev_rotated"

      const tokens = new TokenManager("tat_dev_initial")
      const http = new HttpClient(tokens, logger, { maxRetries: 0 })

      const fetchSpy = vi
        .spyOn(globalThis, "fetch" as any)
        .mockResolvedValueOnce(
          jsonResponse({ error: { reason_code: "trusted_attester_unauthenticated" } }, { status: 401 })
        )
        .mockResolvedValueOnce(jsonResponse({ ok: true }, { status: 201 }))

      const result = await http.post<{ ok: boolean }>(URL, {})
      expect(result.ok).toBe(true)
      expect(fetchSpy).toHaveBeenCalledTimes(2)

      // Second call used the rotated token
      const secondCallHeaders = (fetchSpy.mock.calls[1]![1] as RequestInit).headers as Record<string, string>
      expect(secondCallHeaders["Authorization"]).toBe("Bearer tat_dev_rotated")

      if (originalEnv) process.env.OVERTURO_ATTESTER_TOKEN = originalEnv
      else delete process.env.OVERTURO_ATTESTER_TOKEN
    })

    it("bubbles up 401 when refresh yields no new token", async () => {
      delete process.env.OVERTURO_ATTESTER_TOKEN

      const tokens = new TokenManager("tat_dev_initial")
      const http = new HttpClient(tokens, logger, { maxRetries: 0 })

      mockOnce(jsonResponse({ error: { reason_code: "trusted_attester_unauthenticated" } }, { status: 401 }))

      await expect(http.post(URL, {})).rejects.toBeInstanceOf(OverturoUnauthorized)
    })
  })
})
