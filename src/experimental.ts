// @experimental marker for pre-1.0 stable surfaces.
//
// Emits a console.warn on first call per process per surface, then
// never again. Use sparingly — only for surfaces whose API may change
// in 1.x.

const SEEN = new Set<string>()

export function experimental<F extends (...args: never[]) => unknown>(reason: string, fn: F): F {
  const key = fn.name || "anonymous"
  return ((...args: Parameters<F>): ReturnType<F> => {
    if (!SEEN.has(key)) {
      SEEN.add(key)
      // eslint-disable-next-line no-console
      console.warn(`[overturo] ${key} is experimental: ${reason}. ` + `API may change in @overturo/sdk 1.x.`)
    }
    return fn(...args) as ReturnType<F>
  }) as F
}
