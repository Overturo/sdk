/**
 * Endpoint manifest self-test.
 *
 * `endpoints.json` at the package root declares every endpoint this client
 * calls. This test derives the endpoint paths from the package SOURCE (string
 * and template literals mentioning /api/v1 or /.well-known, comments excluded)
 * and asserts they agree with the manifest after path-parameter normalization.
 * A path composed at runtime from a base literal counts as present when a found
 * literal is a proper prefix of it. Discovered endpoints (resolved from
 * openid-configuration at runtime) are declared with a `discovered` marker and
 * are exempt from the source check.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

type Entry = { method: string; path: string; discovered?: string }
const root = process.cwd()
const manifest = JSON.parse(readFileSync(resolve(root, "endpoints.json"), "utf8")) as { endpoints: Entry[] }

const normalize = (p: string) =>
  p
    .replace(/\$\{[^}]*\}/g, "{}")
    .replace(/\{[^}]*\}/g, "{}")
    .replace(/:[a-z_]+/g, "{}")
    .replace(/(?<=[a-z])\{\}$/, "") // a trailing interpolation after a path segment is a query suffix
    .replace(/[/.,]+$/, "")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(name) && !/\.d\.ts$/.test(name) ? [full] : []
  })
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

let sourceText = ""

function sourcePaths(): Set<string> {
  const found = new Set<string>()
  const re = /(\/api\/v1\/[^\s"'`]*|\/\.well-known\/[^\s"'`]*)/g
  for (const file of sourceFiles(resolve(root, "src"))) {
    // collapse template interpolations only — a brace block would swallow the literals inside it
    const code = stripComments(readFileSync(file, "utf8")).replace(/\$\{[^}]*\}/g, "${}")
    sourceText += code + "\n"
    for (const m of code.matchAll(re)) found.add(normalize(m[1].replace(/[?#].*/, "")))
  }
  return found
}

// A declared path composed from a found base literal counts as built only when
// every literal segment after the base ("/cancel", "/wait") appears in the source.
function composedFrom(declared: string, base: string): boolean {
  if (!declared.startsWith(base + "/")) return false
  const rest = declared
    .slice(base.length)
    .split("/")
    .filter((seg) => seg && seg !== "{}")
  return rest.every((seg) => sourceText.includes(`/${seg}`))
}

describe("endpoints.json", () => {
  const declared = new Set(manifest.endpoints.filter((e) => !e.discovered).map((e) => normalize(e.path)))
  const found = sourcePaths()

  it("declares every endpoint the source builds", () => {
    const undeclared = [...found].filter((f) => !declared.has(f) && ![...declared].some((d) => d.startsWith(f + "/")))
    expect(undeclared).toEqual([])
  })

  it("declares nothing the source does not build", () => {
    const absent = [...declared].filter((d) => !found.has(d) && ![...found].some((f) => composedFrom(d, f)))
    expect(absent).toEqual([])
  })

  it("is well-formed", () => {
    for (const e of manifest.endpoints) {
      expect(["GET", "POST", "PATCH", "PUT", "DELETE"]).toContain(e.method)
      expect(e.path.startsWith("/")).toBe(true)
    }
  })
})
