/**
 * canonical SHA-256 hex digest helper.
 *
 * Algorithm:
 *   1. JCS-canonicalise `input`
 *   2. JCS-canonicalise `output`
 *   3. Concatenate with `|` separator
 *   4. SHA-256 over the UTF-8 bytes
 *   5. Return hex
 *
 * Matches the server's `evidence_digest` validator
 * (`/\A[a-f0-9]{64}\z/` at app/models/oap/attestation.rb).
 */
import { canonicalize } from "../canonicalize.js"

export async function evidenceDigest(input: unknown, output: unknown): Promise<string> {
  const canonical = `${canonicalize(input)}|${canonicalize(output)}`
  const bytes = new TextEncoder().encode(canonical)
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes as BufferSource)
  return hexEncode(new Uint8Array(hashBuffer))
}

function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}
