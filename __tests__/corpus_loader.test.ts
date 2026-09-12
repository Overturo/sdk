import { afterEach, describe, expect, it } from "vitest"
import { join } from "path"
import { corpusBody, corpusDir, corpusResponse } from "./support/corpus"

const VENDORED = join(__dirname, "fixtures", "api_responses")

describe("corpus loader", () => {
  afterEach(() => {
    delete process.env.OVERTURO_API_CORPUS_DIR
  })

  it("loads a recording from the vendored copy alone (the public package is self-contained)", () => {
    process.env.OVERTURO_API_CORPUS_DIR = VENDORED
    expect(corpusDir()).toBe(VENDORED)
    expect(corpusBody<{ vouch: { id: string } }>("Vouches_show").vouch.id).toBe("<PREFIX_ID:1>")
  })

  it("builds a Response for a body-less status without throwing", async () => {
    const res = corpusResponse("Applications_Webhooks_destroy")
    expect(res.status).toBe
    expect(await res.text()).toBe("")
  })
})
