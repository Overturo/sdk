/**
 * Chronicle stream async iterable.
 *
 * Polls GET /api/v1/oap/chronicles, yielding raw chronicle entries.
 * Manages cursor advancement and exponential idle back-off.
 *
 * Usage:
 *   for await (const event of overturoChronicleStream(client, {eventTypePrefix: "conductor."})) {
 *     handle(event)
 *   }
 */

import type { OverturoAuthorize } from "./client.js"

const ALLOWED_PREFIXES = new Set(["conductor.", "oap."])

export interface OverturoChronicleStreamOptions {
  eventTypePrefix: "conductor." | "oap."
  since?: string
  pollIntervalMs?: number
  maxBackoffMs?: number
  /** Injectable timer for tests. */
  sleepFn?: (ms: number) => Promise<void>
}

interface ChroniclesResponse {
  events: Record<string, unknown>[]
  next_cursor: string | null
}

const DEFAULT_POLL_MS = 5_000
const DEFAULT_BACKOFF_MAX_MS = 30_000

export async function* overturoChronicleStream(
  client: OverturoAuthorize,
  opts: OverturoChronicleStreamOptions
): AsyncIterable<Record<string, unknown>> {
  if (!ALLOWED_PREFIXES.has(opts.eventTypePrefix)) {
    throw new Error(
      `eventTypePrefix must be one of: ${Array.from(ALLOWED_PREFIXES).join(", ")}; got ${opts.eventTypePrefix}`
    )
  }
  let cursor = opts.since
  const pollInterval = opts.pollIntervalMs ?? DEFAULT_POLL_MS
  const maxBackoff = opts.maxBackoffMs ?? DEFAULT_BACKOFF_MAX_MS
  const sleep = opts.sleepFn ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  let currentInterval = pollInterval
  while (true) {
    const params: Record<string, string> = { event_type_prefix: opts.eventTypePrefix }
    if (cursor) params.since = cursor
    const raw = (await client.signedGet(`/api/v1/oap/chronicles`, params)) as ChroniclesResponse
    const events = raw?.events ?? []
    if (events.length === 0) {
      await sleep(currentInterval)
      currentInterval = Math.min(currentInterval * 1.5, maxBackoff)
      continue
    }
    currentInterval = pollInterval
    for (const event of events) yield event
    cursor = raw.next_cursor ?? cursor
  }
}
