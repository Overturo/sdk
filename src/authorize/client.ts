import type { DpopKeyPair } from "./dpop.js"
import { signDpopProof } from "./dpop.js"
import { jurisdictionContext } from "./jurisdiction_context.js"
import { OapError } from "../errors.js"
import type { AuthorizeRequest, AuthorizeResponse, OapErrorEnvelope } from "./types.js"

export interface OverturoAuthorizeOptions {
  /** Grant prefix_id (e.g. `ath_us_AbC123…`). */
  grantId: string
  /** Bearer token returned at grant creation. */
  agentToken: string
  /** DPoP keypair bound to the grant at creation. */
  dpopKey: DpopKeyPair
  /**
   * Regional issuer base URL (e.g. `https://us.overturo.com`). In
   * production this is also the API host; in test setups where the
   * receipt issuer differs from the actual server URL pass
   * `apiBaseUrl` separately and `iss` is only used for label/log
   * purposes.
   */
  iss: string
  /**
   * Override for the API host. Defaults to `iss` when omitted. Use this
   * when the receipt `iss` claim and the API origin disagree (typically
   * dev/staging running against a localhost server while still issuing
   * receipts under a production-looking domain).
   */
  apiBaseUrl?: string
  /** Optional fetch override — pass a wrapper for retries, telemetry, mocks. */
  fetch?: typeof fetch
  /** Default timeout for HTTP calls (ms). */
  timeoutMs?: number
}

export interface TokenInfo {
  agent_token: string
  agent_token_expires_at: string
  iss: string
  oap_ver: string
}

/**
 * High-level agent-side wrapper around the OAP authorize + refresh
 * endpoints. Holds the long-lived agent token + DPoP key, signs DPoP
 * proofs per request, and translates the canonical OAP error envelope
 * into typed exceptions.
 *
 * Verification of a receipt is a separate concern — counterparties use
 * `verifyReceiptOffline` directly; agents only need this class to *get*
 * receipts.
 */
export class OverturoAuthorize {
  private readonly grantId: string
  private agentToken: string
  private readonly dpopKey: DpopKeyPair
  private readonly iss: string
  private readonly apiBaseUrl: string
  private readonly fetchFn: typeof fetch
  private readonly timeoutMs: number

  constructor(opts: OverturoAuthorizeOptions) {
    if (!opts.grantId) throw new Error("OverturoAuthorize: grantId is required")
    if (!opts.agentToken) throw new Error("OverturoAuthorize: agentToken is required")
    if (!opts.iss) throw new Error("OverturoAuthorize: iss is required")
    this.grantId = opts.grantId
    this.agentToken = opts.agentToken
    this.dpopKey = opts.dpopKey
    this.iss = opts.iss.replace(/\/+$/, "")
    this.apiBaseUrl = (opts.apiBaseUrl ?? opts.iss).replace(/\/+$/, "")
    this.fetchFn = opts.fetch ?? globalThis.fetch
    this.timeoutMs = opts.timeoutMs ?? 5_000
  }

  /**
   * Submit an authorize request. Throws {@link OapError} on deny / 4xx
   * / 5xx; returns the typed allow/escalate response otherwise.
   */
  async authorize(req: AuthorizeRequest): Promise<AuthorizeResponse> {
    const url = `${this.apiBaseUrl}/api/v1/grants/${this.grantId}/authorize`
    // map the public `jurisdiction` onto the authorize context.
    const { jurisdiction, ...rest } = req
    const wire =
      jurisdiction === undefined ? rest : { ...rest, context: jurisdictionContext(jurisdiction, req.context) }
    const body = JSON.stringify(wire)

    const dpop = await signDpopProof(this.dpopKey, {
      htm: "POST",
      htu: url,
      accessToken: this.agentToken,
    })
    const res = await this.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `DPoP ${this.agentToken}`,
        DPoP: dpop,
      },
      body,
    })

    return (await this.parseResponse(res)) as AuthorizeResponse
  }

  /**
   * Refresh the agent token. Returns the new token + expiry; the
   * SDK keeps the in-memory copy in sync so subsequent authorize
   * calls use the fresh token automatically.
   */
  async refreshToken(): Promise<TokenInfo> {
    const url = `${this.apiBaseUrl}/api/v1/grants/${this.grantId}/token`
    const dpop = await signDpopProof(this.dpopKey, {
      htm: "POST",
      htu: url,
      accessToken: this.agentToken,
    })
    const res = await this.request(url, {
      method: "POST",
      headers: {
        Authorization: `DPoP ${this.agentToken}`,
        DPoP: dpop,
      },
    })
    const info = (await this.parseResponse(res)) as TokenInfo
    this.agentToken = info.agent_token
    return info
  }

  /** Tokens may rotate; expose the current value for log/test inspection. */
  get currentToken(): string {
    return this.agentToken
  }

  // ── typed surfaces ─────────────────

  /** Authorize and return a parsed {@link OverturoDecision}. Same wire
   * shape as `authorize`; just typed. block_invocations is empty. */
  async authorizeTyped(
    req: AuthorizeRequest & { modeHint?: "conductor" | "oversight" | "hybrid" }
  ): Promise<import("./decision.js").OverturoDecision> {
    const raw = await this.authorizeCall(req, false)
    const { parseDecision } = await import("./decision.js")
    return parseDecision(raw)
  }

  /** Authorize with the `Overturo-Decomposed: 1` header. Returned
   * {@link OverturoDecision} carries per-position block_invocations. */
  async authorizeWithDecomposition(
    req: AuthorizeRequest & { modeHint?: "conductor" | "oversight" | "hybrid" }
  ): Promise<import("./decision.js").OverturoDecision> {
    const raw = await this.authorizeCall(req, true)
    const { parseDecision } = await import("./decision.js")
    return parseDecision(raw)
  }

  /** Internal signed GET — used by {@link overturoChronicleStream}. */
  async signedGet(path: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(params).toString()
    const url = `${this.apiBaseUrl}${path}${qs ? `?${qs}` : ""}`
    const dpop = await signDpopProof(this.dpopKey, {
      htm: "GET",
      htu: url,
      accessToken: this.agentToken,
    })
    const res = await this.request(url, {
      method: "GET",
      headers: {
        Authorization: `DPoP ${this.agentToken}`,
        DPoP: dpop,
      },
    })
    return this.parseResponse(res)
  }

  private async authorizeCall(req: AuthorizeRequest & { modeHint?: string }, decompose: boolean): Promise<unknown> {
    const url = `${this.apiBaseUrl}/api/v1/grants/${this.grantId}/authorize`
    const allowedModes = new Set(["conductor", "oversight", "hybrid"])
    const body: Record<string, unknown> = {
      nonce: req.nonce,
      action: req.action,
      scope: req.scope,
    }
    if (req.value !== undefined) body.value = req.value
    if (req.currency !== undefined) body.currency = req.currency
    if (req.counterparty !== undefined) body.counterparty = req.counterparty
    if (req.context !== undefined) body.context = req.context
    if (req.modeHint !== undefined) {
      if (!allowedModes.has(req.modeHint)) {
        throw new Error(`invalid modeHint: ${req.modeHint}`)
      }
      body.mode_hint = req.modeHint
    }
    const dpop = await signDpopProof(this.dpopKey, {
      htm: "POST",
      htu: url,
      accessToken: this.agentToken,
    })
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `DPoP ${this.agentToken}`,
      DPoP: dpop,
    }
    if (decompose) headers["Overturo-Decomposed"] = "1"
    const res = await this.request(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
    return this.parseResponse(res)
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  private async parseResponse(res: Response): Promise<unknown> {
    const text = await res.text()
    if (res.ok) {
      return text ? JSON.parse(text) : {}
    }
    let envelope: OapErrorEnvelope | undefined
    try {
      envelope = text ? (JSON.parse(text) as OapErrorEnvelope) : undefined
    } catch {
      envelope = undefined
    }
    if (envelope && envelope.error?.reason_code) {
      throw OapError.fromEnvelope(envelope, res.status)
    }
    // Server returned a non-envelope body (proxy 502, etc.). Fall back
    // to a synthetic internal_error so callers see a consistent type.
    throw new OapError({
      reason_code: "internal_error",
      message: `Unexpected HTTP ${res.status} from OAP authorize endpoint`,
      http_status: res.status,
      detail: { body: text.slice(0, 512) },
    })
  }
}
