/**
 * sequence-number manager.
 *
 * Tracks an in-memory monotonic counter; emits each new value via
 * `onSequenceUpdate(seq)` so host apps can durably persist (Redis,
 * file, DB). Atomic — `next()` is sync (caller serialises submission).
 *
 * On SDK restart: host MUST re-pass the persisted value as
 * `startSequence` config. Without persistence, restart with the same
 * (attester, touchpoint) tuple trips the server's `AttestationOutOfOrder`
 * + `attestation.gap_detected` audit event.
 */
export class SequenceManager {
  private nextSeq: number

  constructor(
    startSequence: number,
    private readonly onUpdate?: (seq: number) => void | Promise<void>
  ) {
    if (!Number.isInteger(startSequence) || startSequence < 1) {
      throw new Error(`startSequence must be a positive integer; got ${startSequence}`)
    }
    this.nextSeq = startSequence
  }

  next(): number {
    return this.nextSeq++
  }

  async persist(seq: number): Promise<void> {
    if (this.onUpdate) await this.onUpdate(seq)
  }

  /** Test / debug helper. */
  peek(): number {
    return this.nextSeq
  }
}
