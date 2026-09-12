// error-tree unification regression tests.
//
// Mirrors the Python `tests/shared/test_errors_dispatch.py` invariants
// for the JS side: OapError is rooted under OverturoError so a single
// `instanceof OverturoError` catches both protocol and transport
// errors; the two sub-trees do not cross-catch; OapApprovalRequired
// redacts session_token in toString().

import { describe, expect, it } from "vitest"

import {
  OapApprovalRequired,
  OapAuthorizationDenied,
  OapDispatchError,
  OapError,
  OapEscalationDenied,
  OapIntentDenied,
  OapSequenceDenied,
  OapTrajectoryDenied,
  OapWrongRegion,
  OverturoApiError,
  OverturoError,
  OverturoRateLimited,
  OverturoUnauthorized,
  isOapError,
} from "../../src/errors.js"

describe("error-tree unification (parity with Python)", () => {
  it("OapError is rooted under OverturoError", () => {
    const e = new OapError({ reason_code: "internal_error" as never, message: "x" })
    expect(e).toBeInstanceOf(OverturoError)
    expect(e).toBeInstanceOf(OapError)
    expect(isOapError(e)).toBe(true)
  })

  it("OverturoApiError is rooted under OverturoError", () => {
    const e = new OverturoApiError("500")
    expect(e).toBeInstanceOf(OverturoError)
    expect(e).toBeInstanceOf(OverturoApiError)
    expect(isOapError(e)).toBe(false)
  })

  it("protocol and transport sub-trees do not cross-catch", () => {
    const oap = new OapError({ reason_code: "internal_error" as never, message: "x" })
    const transport = new OverturoApiError("500")
    expect(oap).not.toBeInstanceOf(OverturoApiError)
    expect(transport).not.toBeInstanceOf(OapError)
  })

  it("typed OAP subclasses inherit OverturoError", () => {
    const denied = new OapAuthorizationDenied({
      reason_code: "auth_invalid" as never,
      message: "denied",
    })
    expect(denied).toBeInstanceOf(OapError)
    expect(denied).toBeInstanceOf(OverturoError)
  })

  it("OverturoRateLimited forwards 429 status through OverturoError", () => {
    const e = new OverturoRateLimited("429", { retryAfterSeconds: 30 })
    expect(e).toBeInstanceOf(OverturoError)
    expect(e.httpStatus).toBe
    expect(e.retryAfterSeconds).toBe(30)
  })
})

describe("OapError.fromEnvelope dispatch", () => {
  const cases: Array<[string, typeof OapError]> = [
    ["sequence_prohibited", OapSequenceDenied],
    ["sequence_missing_predecessor", OapSequenceDenied],
    ["escalation_denied", OapEscalationDenied],
    ["dispatch_error", OapDispatchError],
    ["wrong_region", OapWrongRegion],
  ]

  it.each(cases)("reason_code=%s → %s", (reasonCode, expectedClass) => {
    const err = OapError.fromEnvelope({ error: { reason_code: reasonCode as never, message: "x" } }, 403)
    expect(err).toBeInstanceOf(expectedClass)
  })

  const categories: Array<[string, typeof OapError]> = [
    ["authorization_denied", OapAuthorizationDenied],
    ["intent_denied", OapIntentDenied],
    ["trajectory_denied", OapTrajectoryDenied],
  ]

  it.each(categories)("denial_category=%s → %s", (category, expectedClass) => {
    const err = OapError.fromEnvelope(
      {
        error: {
          reason_code: "auth_invalid" as never,
          message: "x",
          denial_category: category as never,
        },
      },
      403
    )
    expect(err).toBeInstanceOf(expectedClass)
  })

  it("approval_required → OapApprovalRequired", () => {
    const err = OapError.fromEnvelope(
      {
        error: {
          reason_code: "approval_required" as never,
          message: "needs approval",
          // @ts-expect-error escalation is an OapApprovalRequired-specific extension
          escalation: {
            escalation_id: "esc_dev_abc",
            required_signers: ["alice"],
            approval_ttl_at: "2026-06-10T12:00:00Z",
            decision_url: "https://x.example?token=sk_secret",
            session_token: "sk_secret",
          },
        },
      },
      409
    )
    expect(err).toBeInstanceOf(OapApprovalRequired)
    expect((err as OapApprovalRequired).escalation_id).toBe("esc_dev_abc")
    expect((err as OapApprovalRequired).required_signers).toEqual(["alice"])
  })

  it("OapApprovalRequired.toString() redacts session_token + decision_url", () => {
    const err = new OapApprovalRequired({
      reason_code: "approval_required" as never,
      message: "needs approval",
      decision_url: "https://x.example?token=sk_secret",
      session_token: "sk_secret",
      escalation_id: "esc_test",
    })
    expect(err.toString()).not.toContain("sk_secret")
    expect(err.toString()).toContain("esc_test")
  })

  it("unknown reason + no category falls through to OapError", () => {
    const err = OapError.fromEnvelope({ error: { reason_code: "internal_error" as never, message: "x" } }, 500)
    expect(err.constructor).toBe(OapError)
  })
})
