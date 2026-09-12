/**
 * RFC 8785 JSON Canonicalization Scheme
 * (JCS), trimmed implementation for `evidenceDigest`.
 *
 * Covers the surface OPA decision-log records use: objects with
 * string keys, arrays, strings, numbers, booleans, null. Doesn't
 * (yet) cover the full RFC 8785 number-normalization corner cases
 * (NaN, ±Infinity, -0); those don't appear in OPA outputs.
 */

export function canonicalize(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`canonicalize: non-finite number ${value} is not representable in JCS`)
    }
    // Number canonicalization: JCS uses ES2015 ToString(Number), which
    // is the same as JSON.stringify for finite numbers.
    return JSON.stringify(value)
  }
  if (typeof value === "string") return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>
    const sortedKeys = Object.keys(obj).sort()
    const entries = sortedKeys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
    return `{${entries.join(",")}}`
  }
  throw new Error(`canonicalize: unsupported type ${typeof value}`)
}
