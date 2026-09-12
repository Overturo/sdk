/**
 * token-rotation manager.
 *
 * On 401 the SDK calls `refresh()` to read a new token from either
 * the configured `tokenProvider` or the `OVERTURO_ATTESTER_TOKEN`
 * env var. If the value changed, retry the failed request once.
 * The server's two-slot rotation (24h overlap) makes the gap invisible
 * when the host app updates env within the overlap window.
 */
export class TokenManager {
  private currentToken: string

  constructor(
    initial: string,
    private readonly tokenProvider?: () => string | Promise<string>
  ) {
    this.currentToken = initial
  }

  current(): string {
    return this.currentToken
  }

  /**
   * Refresh from the configured provider (or env). Returns `true`
   * when the token CHANGED — callers should retry the failed
   * request. Returns `false` when the refresh yielded the same
   * token (no rotation; the 401 is a real auth failure).
   */
  async refresh(): Promise<boolean> {
    const next = this.tokenProvider
      ? await this.tokenProvider()
      : (process.env.OVERTURO_ATTESTER_TOKEN ?? this.currentToken)
    if (next === this.currentToken) return false
    this.currentToken = next
    return true
  }
}
