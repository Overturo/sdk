/**
 * Minimal HTTP server that exposes the OPA adapter to Overturo
 * (`conductor.policy_gate` `external_endpoint_url`).
 *
 * Uses Node's built-in `node:http` for portability — no Hono / Express /
 * Fastify dependency. Production deployments swap this for a hardened
 * framework.
 *
 * Run:
 *
 *   npx tsx server.ts --policy policy.json --port 8089
 *
 * (or compile via `tsc` and run the .js output with node).
 *
 * Reference implementation.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { InMemoryOpaEvaluator, OpaAdapter } from "./opaAdapter.js"

interface CliArgs {
  policyPath: string
  host: string
  port: number
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    policyPath: join(dirname(fileURLToPath(import.meta.url)), "policy.json"),
    host: "127.0.0.1",
    port: 8089,
  }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]
    if (v === "--policy") out.policyPath = argv[++i] ?? out.policyPath
    else if (v === "--host") out.host = argv[++i] ?? out.host
    else if (v === "--port") out.port = Number.parseInt(argv[++i] ?? "8089", 10)
  }
  return out
}

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (c) => chunks.push(c as Buffer))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  })
  res.end(payload)
}

export function createOpaServer(adapter: OpaAdapter) {
  return createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/evaluate") {
      sendJson(res, 404, { error: "not_found" })
      return
    }
    let body: Record<string, unknown>
    try {
      const raw = await readBody(req)
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      sendJson(res, 400, { error: "malformed_json" })
      return
    }
    try {
      const decision = await adapter.evaluate(body as never)
      sendJson(res, 200, decision)
    } catch (e) {
      sendJson(res, 500, { error: "adapter_failure", detail: String(e).slice(0, 200) })
    }
  })
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const evaluator = InMemoryOpaEvaluator.fromFile(args.policyPath)
  const adapter = new OpaAdapter(evaluator)
  const server = createOpaServer(adapter)
  server.listen(args.port, args.host, () => {
    console.log(`[opa_adapter] listening on http://${args.host}:${args.port}/evaluate`)
    console.log(`[opa_adapter] policy: ${args.policyPath}`)
  })
}

// Only run when invoked as a script (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
