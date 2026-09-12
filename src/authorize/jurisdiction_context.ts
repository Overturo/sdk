// audit-public-language: allow
//
// maps the SDK's public `jurisdiction` parameter (an ISO country)
// onto the internal authorize-context routing key the platform reads. The wire
// key is an internal routing field, so this single mapping is confined to this
// opt-out-marked file; the rest of the SDK stays under the language firewall and
// only ever speaks of `jurisdiction` / country.

/**
 * Merge the declared jurisdiction into the authorize context the platform reads.
 */
export function jurisdictionContext(
  jurisdiction: string,
  context: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...context, destination_region: jurisdiction }
}
