import { describe, expect, it } from "vitest"

import {
  OapAuthorizationDenied,
  OapError,
  OapIntentDenied,
  OapSequenceDenied,
  OapTrajectoryDenied,
  isOapError,
} from "../../src/errors.js"
import type { OapErrorEnvelope } from "../../src/authorize/types.js"

// OapError.fromEnvelope dispatches to the right
// category subclass based on the envelope's `denial_category`.
// Non-cascade errors (no denial_category) fall back to the base class.
describe("OapError.fromEnvelope dispatch", () => {
  const envelopeWith = (extra: Partial<OapErrorEnvelope["error"]>): OapErrorEnvelope => ({
    error: {
      reason_code: "scope_not_covered",
      message: "demo",
      oap_ver: "1.0",
      ...extra,
    },
  })

  it("returns OapAuthorizationDenied when denial_category=authorization_denied", () => {
    const err = OapError.fromEnvelope(
      envelopeWith({
        reason_code: "dpop_invalid",
        denial_category: "authorization_denied",
        cascade_step: 1,
      }),
      401
    )
    expect(err).toBeInstanceOf(OapAuthorizationDenied)
    expect(err).toBeInstanceOf(OapError)
    expect(isOapError(err)).toBe(true)
    expect(err.denial_category).toBe("authorization_denied")
    expect(err.cascade_step).toBe(1)
    expect(err.http_status).toBe
  })

  it("returns OapIntentDenied when denial_category=intent_denied", () => {
    const err = OapError.fromEnvelope(
      envelopeWith({
        reason_code: "action_not_allowed",
        denial_category: "intent_denied",
        cascade_step: 7,
        failed_bound: "action_bounds",
      }),
      403
    )
    expect(err).toBeInstanceOf(OapIntentDenied)
    expect(err.denial_category).toBe("intent_denied")
    expect(err.cascade_step).toBe(7)
    expect(err.failed_bound).toBe("action_bounds")
  })

  it("returns OapTrajectoryDenied when denial_category=trajectory_denied", () => {
    const err = OapError.fromEnvelope(
      envelopeWith({
        reason_code: "value_exceeds_tx_max",
        denial_category: "trajectory_denied",
        cascade_step: 10,
        failed_bound: "value_bounds",
      }),
      403
    )
    expect(err).toBeInstanceOf(OapTrajectoryDenied)
    expect(err.denial_category).toBe("trajectory_denied")
    expect(err.cascade_step).toBe(10)
  })

  it("falls back to OapError when denial_category is absent (non-cascade)", () => {
    const err = OapError.fromEnvelope(envelopeWith({ reason_code: "validation_failed" }), 422)
    // The base class is returned, NOT any of the three subclasses.
    expect(err.constructor).toBe(OapError)
    expect(err).not.toBeInstanceOf(OapAuthorizationDenied)
    expect(err).not.toBeInstanceOf(OapIntentDenied)
    expect(err).not.toBeInstanceOf(OapTrajectoryDenied)
    expect(err.denial_category).toBeUndefined()
    expect(err.cascade_step).toBeUndefined()
  })

  it("subclasses preserve their distinct `name` property", () => {
    const auth = OapError.fromEnvelope(
      envelopeWith({
        denial_category: "authorization_denied",
        cascade_step: 1,
      })
    )
    const intent = OapError.fromEnvelope(envelopeWith({ denial_category: "intent_denied", cascade_step: 7 }))
    const traj = OapError.fromEnvelope(envelopeWith({ denial_category: "trajectory_denied", cascade_step: 10 }))
    expect(auth.name).toBe("OapAuthorizationDenied")
    expect(intent.name).toBe("OapIntentDenied")
    expect(traj.name).toBe("OapTrajectoryDenied")
  })

  it("preserves cascade_step omission (server rate-limit suppression)", () => {
    // After THRESHOLD denials the server omits cascade_step but
    // keeps denial_category. The SDK MUST tolerate the missing field
    // without falling back to the base class.
    const err = OapError.fromEnvelope(
      envelopeWith({
        reason_code: "action_not_allowed",
        denial_category: "intent_denied",
        // no cascade_step
      })
    )
    expect(err).toBeInstanceOf(OapIntentDenied)
    expect(err.denial_category).toBe("intent_denied")
    expect(err.cascade_step).toBeUndefined()
  })

  it("allows catching by category via `instanceof`", () => {
    const denials = [
      OapError.fromEnvelope(envelopeWith({ denial_category: "intent_denied" })),
      OapError.fromEnvelope(envelopeWith({ denial_category: "intent_denied" })),
      OapError.fromEnvelope(envelopeWith({ denial_category: "trajectory_denied" })),
    ]

    const intentCount = denials.filter((d) => d instanceof OapIntentDenied).length
    const trajCount = denials.filter((d) => d instanceof OapTrajectoryDenied).length
    expect(intentCount).toBe(2)
    expect(trajCount).toBe(1)
    // Every category subclass is still an OapError.
    expect(denials.every((d) => d instanceof OapError)).toBe(true)
  })

  // ── SequenceDenied subclass ────────────────────
  describe("OapSequenceDenied", () => {
    it("dispatches sequence_prohibited to OapSequenceDenied", () => {
      const err = OapError.fromEnvelope(
        envelopeWith({
          reason_code: "sequence_prohibited",
          denial_category: "trajectory_denied",
          cascade_step: 13,
        }),
        403
      )
      expect(err).toBeInstanceOf(OapSequenceDenied)
      expect(err).toBeInstanceOf(OapTrajectoryDenied)
      expect(err).toBeInstanceOf(OapError)
      expect(err.name).toBe("OapSequenceDenied")
    })

    it("dispatches sequence_missing_predecessor to OapSequenceDenied", () => {
      const err = OapError.fromEnvelope(
        envelopeWith({
          reason_code: "sequence_missing_predecessor",
          denial_category: "trajectory_denied",
          cascade_step: 13,
        }),
        403
      )
      expect(err).toBeInstanceOf(OapSequenceDenied)
    })

    it("does NOT downgrade other trajectory_denied codes to the sequence subclass", () => {
      const err = OapError.fromEnvelope(
        envelopeWith({
          reason_code: "value_exceeds_tx_max",
          denial_category: "trajectory_denied",
          cascade_step: 10,
        }),
        403
      )
      expect(err).toBeInstanceOf(OapTrajectoryDenied)
      expect(err).not.toBeInstanceOf(OapSequenceDenied)
    })
  })
})
