// pre-flight disclosure discovery (discoverFlowDisclosures) tests.
// Decodes the shared conformance fixture (lib/sdk/shared/conformance/discovery/
// flow_disclosures.json) — the same corpus the server + the other three clients
// hold. This server client does NOT camelCase, so it decodes the snake_case
// wire verbatim.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OverturoApiError, OverturoValidationError } from "../../src/errors.js"
import { HttpClient } from "../../src/http.js"
import { Logger } from "../../src/logger.js"
import { TokenManager } from "../../src/oversight/token.js"
import { discoverFlowDisclosures } from "../../src/decisions/index.js"

const BASE = "https://api.test.local"
const FLOW_ID = "flw_test_discovery"
const PK = "pk_test_x"
const SHARED_FIXTURE = join(__dirname, "..", "..", "..", "shared", "conformance", "discovery", "flow_disclosures.json")
// The shared fixture when this package sits next to it; the vendored copy otherwise.
const FIXTURE_PATH = existsSync(SHARED_FIXTURE)
  ? SHARED_FIXTURE
  : join(__dirname, "..", "fixtures", "discovery", "flow_disclosures.json")
const FIXTURE_TEXT = readFileSync(FIXTURE_PATH, "utf8")

function makeHttp(): HttpClient {
  return new HttpClient(new TokenManager("tat_dev_initial"), new Logger("silent"))
}

function fixtureResponse(status = 200, body = FIXTURE_TEXT): Response {
  return new Response(body, { status, headers: new Headers({ "content-type": "application/json" }) })
}

describe("discoverFlowDisclosures", () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it("decodes the shared fixture (snake_case wire, verbatim)", async () => {
    vi.spyOn(globalThis, "fetch" as never).mockResolvedValueOnce(fixtureResponse())

    const result = await discoverFlowDisclosures(makeHttp(), {
      baseUrl: BASE,
      flowId: FLOW_ID,
      publishableKey: PK,
    })

    expect(result.schema).toBe("overturo-disclosure/1")
    expect(result.flow.kind).toBe("consent")
    expect(result.application.primary_color).toBe("#0B5FFF")
    expect(result.expiry.consent_duration_days).toBe
    const purpose = result.purposes.find((p) => p.name === "care_reminders")
    expect(purpose?.mechanism).toBe("opt_out")
    expect(purpose?.legal_basis).toBe("consent")
    expect(result.fields.map((f) => f.completed_by)).toContain("principal")
    expect(result.outcomes).toEqual(["granted", "denied"])
  })

  it("GETs the disclosures path with the publishable key + locale query", async () => {
    const spy = vi.spyOn(globalThis, "fetch" as never).mockResolvedValueOnce(fixtureResponse())

    await discoverFlowDisclosures(makeHttp(), {
      baseUrl: BASE,
      flowId: FLOW_ID,
      publishableKey: PK,
      locale: "de",
    })

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe(`${BASE}/api/v1/decisions/flows/${FLOW_ID}/disclosures?locale=de`)
    expect((init.headers as Record<string, string>)["X-Publishable-Key"]).toBe(PK)
    expect(init.method).toBe("GET")
  })

  it("validates flowId and publishableKey before any request", async () => {
    const spy = vi.spyOn(globalThis, "fetch" as never)

    await expect(
      discoverFlowDisclosures(makeHttp(), { baseUrl: BASE, flowId: "", publishableKey: PK })
    ).rejects.toBeInstanceOf(OverturoValidationError)
    await expect(
      discoverFlowDisclosures(makeHttp(), { baseUrl: BASE, flowId: FLOW_ID, publishableKey: "" })
    ).rejects.toBeInstanceOf(OverturoValidationError)

    expect(spy).not.toHaveBeenCalled()
  })

  it("surfaces the uniform 404 (this client maps 404 → OverturoValidationError with httpStatus)", async () => {
    vi.spyOn(globalThis, "fetch" as never).mockResolvedValue(
      fixtureResponse(404, JSON.stringify({ error: { message: "Flow not found" } }))
    )

    const err = await discoverFlowDisclosures(makeHttp(), {
      baseUrl: BASE,
      flowId: FLOW_ID,
      publishableKey: PK,
    }).catch((e) => e)

    expect(err).toBeInstanceOf(OverturoValidationError)
    expect(err.httpStatus).toBe
  })

  it("omits the locale query when none is given", async () => {
    const spy = vi.spyOn(globalThis, "fetch" as never).mockResolvedValueOnce(fixtureResponse())

    await discoverFlowDisclosures(makeHttp(), { baseUrl: BASE, flowId: FLOW_ID, publishableKey: PK })

    const [url] = spy.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe(`${BASE}/api/v1/decisions/flows/${FLOW_ID}/disclosures`)
    expect(String(url)).not.toContain("locale")
  })

  it("does not double the slash when baseUrl has a trailing slash", async () => {
    const spy = vi.spyOn(globalThis, "fetch" as never).mockResolvedValueOnce(fixtureResponse())

    await discoverFlowDisclosures(makeHttp(), {
      baseUrl: `${BASE}/`,
      flowId: FLOW_ID,
      publishableKey: PK,
    })

    const [url] = spy.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe(`${BASE}/api/v1/decisions/flows/${FLOW_ID}/disclosures`)
  })

  it("raises a typed error on an envelope-less 200", async () => {
    vi.spyOn(globalThis, "fetch" as never).mockResolvedValue(fixtureResponse(200, JSON.stringify({ unexpected: true })))

    const err = await discoverFlowDisclosures(makeHttp(), {
      baseUrl: BASE,
      flowId: FLOW_ID,
      publishableKey: PK,
    }).catch((e) => e)

    expect(err).toBeInstanceOf(OverturoApiError)
  })
})
