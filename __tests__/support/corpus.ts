// Recorded API exchanges, keyed by operationId. Each recording was made against
// the real API and validated against the published OpenAPI document, so a
// response built from one is what the client will actually see. Ids, timestamps
// and tokens are placeholders (`<PREFIX_ID:n>`, `2026-01-01T00:00:00Z`, `<TOKEN>`).
//
// The shared corpus is read when this package sits next to it; the public mirror
// carries the vendored copy under __tests__/fixtures/api_responses. OVERTURO_API_CORPUS_DIR
// overrides the location (used to prove the vendored copy is self-contained).
import { existsSync, readFileSync } from "fs"
import { join } from "path"

const SHARED = join(__dirname, "..", "..", "..", "shared", "conformance", "api_responses")
const VENDORED = join(__dirname, "..", "fixtures", "api_responses")

export interface CorpusExchange {
  operationId: string
  request: {
    method: string
    path: string
    query?: Record<string, string>
    headers: Record<string, string>
    body?: unknown
  }
  response: { status: number; headers: Record<string, string>; body: unknown }
  document: string
}

export function corpusDir(): string {
  return process.env.OVERTURO_API_CORPUS_DIR ?? (existsSync(SHARED) ? SHARED : VENDORED)
}

export function corpusExchange(operationId: string, step?: string): CorpusExchange {
  const file = join(corpusDir(), `${operationId}${step ? `.${step}` : ""}.json`)
  return JSON.parse(readFileSync(file, "utf8")) as CorpusExchange
}

export function corpusBody<T = unknown>(operationId: string, step?: string): T {
  return corpusExchange(operationId, step).response.body as T
}

/** A fetch Response carrying the recorded status, headers and body. */
export function corpusResponse(operationId: string, step?: string): Response {
  const { response } = corpusExchange(operationId, step)
  // a null-body status (204/205/304) must get a null body — Response() throws on "" there
  const body = response.body === null || response.body === undefined ? null : JSON.stringify(response.body)
  return new Response(body, { status: response.status, headers: response.headers })
}
