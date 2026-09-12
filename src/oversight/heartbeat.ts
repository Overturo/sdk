/**
 * heartbeat manager.
 *
 * Periodic POST to the discovery-resolved heartbeat endpoint.
 * Failures log + continue — the server's
 * `attestation.heartbeat_missed` audit event is the
 * operator-side signal.
 */
import type { HttpClient } from "../http.js"
import type { Logger } from "../logger.js"

export class HeartbeatManager {
  private intervalHandle: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly http: HttpClient,
    private readonly heartbeatUrl: string,
    private readonly cadenceSeconds: number,
    private readonly logger: Logger
  ) {}

  start(): void {
    if (this.intervalHandle) return
    this.intervalHandle = setInterval(() => {
      this.tick().catch((e) => {
        const message = e instanceof Error ? e.message : String(e)
        this.logger.warn(`heartbeat tick failed: ${message}`)
      })
    }, this.cadenceSeconds * 1000)
    // Don't keep the process alive just for heartbeats.
    if (typeof this.intervalHandle === "object" && this.intervalHandle && "unref" in this.intervalHandle) {
      ;(this.intervalHandle as { unref: () => void }).unref()
    }
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
  }

  /** Exposed for tests + the conformance harness. */
  async tick(): Promise<void> {
    await this.http.heartbeat(this.heartbeatUrl)
  }
}
