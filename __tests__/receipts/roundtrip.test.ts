/**
 * the retrieve-signed → verify-offline round-trip, Node
 * half. `@overturo/verify` is deliberately NOT a dependency of this
 * package (it must stay standalone), so the verification half of the
 * round-trip lives in overturo-verify's corpus suite and the live e2e
 * (bin/e2e-authority-sdk) where both packages install side by side.
 * What this test pins is the client's half of the contract: the raw
 * path returns the server bytes UNTOUCHED — byte-identical to the
 * corpus fixture the stub serves — so whatever verifyRecord accepts
 * from the corpus, it accepts from this client.
 */
import { describe, expect, test } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { OverturoReceipts } from "../../src/receipts/index.js"

// The shared corpus when this package sits next to it; the vendored copy otherwise.
const SHARED_CORPUS = join(__dirname, "..", "..", "..", "shared", "conformance", "signed_records")
const CORPUS_DIR = existsSync(SHARED_CORPUS) ? SHARED_CORPUS : join(__dirname, "..", "fixtures", "signed_records")

describe("signed round-trip (client half)", () => {
  test("raw retrieval is byte-identical to the served corpus fixture", async () => {
    const raw = readFileSync(join(CORPUS_DIR, "authorization_record_valid.json"), "utf8")
    const fetchFn = (async () =>
      new Response(raw, { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch

    const receipts = new OverturoReceipts({
      baseUrl: "https://overturo.example",
      apiToken: "tok",
      fetchFn,
    })

    const text = await receipts.retrieveSignedAuthorizationReceiptRaw("acc_123")

    expect(text).toBe(raw)
    // The fixture carries a non-integer lexeme; prove it survives.
    expect(text).toContain("5.0")
    expect(JSON.stringify(JSON.parse(text))).not.toContain("5.0") // and why raw matters
  })
})
