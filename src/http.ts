/**
 * HTTP client with retry + `Retry-After`.
 *
 * Wraps the global `fetch` with:
 *   - Bearer auth (sourced from TokenManager)
 *   - Exponential backoff on 429 / 5xx (honors `Retry-After` header)
 *   - One-shot token-rotation retry on 401
 *   - Per-request timeout (AbortController)
 *   - SDK error class mapping by HTTP status / reason_code
 */
import {
  OverturoApiError,
  OverturoNetworkError,
  OverturoRateLimited,
  OverturoServerError,
  OverturoTimeoutError,
  OverturoUnauthorized,
  OverturoValidationError,
} from "./errors.js"
import type { Logger } from "./logger.js"
import type { TokenManager } from "./oversight/token.js"

interface RequestOpts {
  method: "GET" | "POST"
  url: string
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
}

export interface HttpClientConfig {
  maxRetries?: number
  defaultTimeoutMs?: number
}

export class HttpClient {
  private readonly maxRetries: number
  private readonly defaultTimeoutMs: number

  constructor(
    private readonly tokens: TokenManager,
    private readonly logger: Logger,
    cfg: HttpClientConfig = {}
  ) {
    this.maxRetries = cfg.maxRetries ?? 3
    this.defaultTimeoutMs = cfg.defaultTimeoutMs ?? 30_000
  }

  async post<T>(url: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
    return this.requestJson<T>({ method: "POST", url, body, headers: extraHeaders })
  }

  // GET with extra headers (the discovery helper passes X-Publishable-Key).
  // Mirrors post(); rides the same retry/timeout machinery.
  async get<T>(url: string, extraHeaders: Record<string, string> = {}): Promise<T> {
    return this.requestJson<T>({ method: "GET", url, headers: extraHeaders })
  }

  async heartbeat(url: string): Promise<void> {
    await this.request({ method: "POST", url, body: {} })
  }

  private async requestJson<T>(req: RequestOpts): Promise<T> {
    const response = await this.request(req)
    if (response.status === 204) return undefined as unknown as T
    return (await response.json()) as T
  }

  private async request(req: RequestOpts): Promise<Response> {
    let attempt = 0
    let tokenRetried = false

    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt++
      const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs

      let response: Response
      try {
        response = await this.send(req, timeoutMs)
      } catch (e) {
        if (e instanceof OverturoTimeoutError || e instanceof OverturoNetworkError) {
          // Network errors retry up to maxRetries with exponential backoff.
          if (attempt > this.maxRetries) throw e
          await sleep(exponentialBackoffMs(attempt))
          continue
        }
        throw e
      }

      if (response.ok) return response

      // try a one-shot token rotation; bubble up on second 401.
      if (response.status === 401 && !tokenRetried) {
        const rotated = await this.tokens.refresh()
        if (rotated) {
          this.logger.info("Token rotated after 401; retrying request once")
          tokenRetried = true
          attempt = 0
          continue
        }
      }

      // 429 / 5xx: honor Retry-After + exponential backoff up to maxRetries.
      if (response.status === 429 || response.status >= 500) {
        if (attempt > this.maxRetries) {
          return this.raiseError(response, req)
        }
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"))
        const backoffMs = retryAfter ?? exponentialBackoffMs(attempt)
        this.logger.warn(
          `HTTP ${response.status} on ${req.url}; backing off ${backoffMs}ms (attempt ${attempt}/${this.maxRetries})`
        )
        await sleep(backoffMs)
        continue
      }

      return this.raiseError(response, req)
    }
  }

  private async send(req: RequestOpts, timeoutMs: number): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.tokens.current()}`,
      Accept: "application/json",
      ...req.headers,
    }
    if (req.body !== undefined) headers["Content-Type"] = "application/json"

    try {
      const response = await fetch(req.url, {
        method: req.method,
        headers,
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        signal: controller.signal,
      })
      return response
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new OverturoTimeoutError(`Request to ${req.url} timed out after ${timeoutMs}ms`)
      }
      const message = e instanceof Error ? e.message : String(e)
      throw new OverturoNetworkError(`Network error on ${req.url}: ${message}`)
    } finally {
      clearTimeout(timer)
    }
  }

  private async raiseError(response: Response, req: RequestOpts): Promise<never> {
    const requestId = response.headers.get("x-request-id") ?? undefined
    let body: { error?: { reason_code?: string; message?: string; detail?: unknown } } = {}
    try {
      body = (await response.json()) as typeof body
    } catch {
      // Non-JSON error body; leave body empty.
    }

    const reasonCode = body.error?.reason_code
    const message = body.error?.message ?? `HTTP ${response.status} on ${req.url}`
    const detail = body.error?.detail
    const base = { reasonCode, detail, requestId }

    switch (response.status) {
      case 401:
        throw new OverturoUnauthorized(message, base)
      case 422:
      case 400:
      case 404:
      case 403:
      case 409:
        throw new OverturoValidationError(message, { ...base, httpStatus: response.status })
      case 429: {
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"))
        throw new OverturoRateLimited(message, {
          ...base,
          retryAfterSeconds: retryAfter ? Math.ceil(retryAfter / 1000) : undefined,
        })
      }
      default:
        if (response.status >= 500) {
          throw new OverturoServerError(message, { ...base, httpStatus: response.status })
        }
        throw new OverturoApiError(message, { ...base, httpStatus: response.status })
    }
  }
}

// ── helpers ────────────────────────────────────────────────────────

function exponentialBackoffMs(attempt: number): number {
  // 1s, 2s, 4s, 8s ... capped at 30s; ±250ms jitter
  const base = Math.min(1000 * 2 ** (attempt - 1), 30_000)
  return base + Math.floor(Math.random() * 250)
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const trimmed = header.trim()
  const seconds = parseInt(trimmed, 10)
  if (!isNaN(seconds) && /^\d+$/.test(trimmed)) return seconds * 1000
  const dateMs = Date.parse(trimmed)
  if (isNaN(dateMs)) return null
  return Math.max(0, dateMs - Date.now())
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
