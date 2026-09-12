/**
 * SDK logger with token redaction.
 *
 * NEVER emits the bearer token at any log level. Configurable
 * verbosity via `logLevel`.
 */
export type LogLevel = "silent" | "warn" | "info" | "debug"

const LEVELS: Record<LogLevel, number> = {
  silent: 0,
  warn: 1,
  info: 2,
  debug: 3,
}

export class Logger {
  constructor(private readonly level: LogLevel = "warn") {}

  warn(message: string, ...args: unknown[]): void {
    if (LEVELS[this.level] >= LEVELS.warn) {
      console.warn(`[OverturoOversight] ${redactString(message)}`, ...redact(args))
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (LEVELS[this.level] >= LEVELS.info) {
      console.info(`[OverturoOversight] ${redactString(message)}`, ...redact(args))
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (LEVELS[this.level] >= LEVELS.debug) {
      console.debug(`[OverturoOversight] ${redactString(message)}`, ...redact(args))
    }
  }
}

function redactString(s: string): string {
  return s.replace(TOKEN_PATTERN, "tat_<redacted>")
}

/**
 * Defensive: scrub any string that looks like a TrustedAttester
 * bearer token from the args list before logging.
 *
 * Token shape: `tat_<region>_<urlsafe_base64>`.
 * `SecureRandom.urlsafe_base64` emits `-` and `_` in the high-entropy
 * suffix, so the character class MUST include them — a `[A-Za-z0-9]+`
 * pattern truncates real tokens at the first `_`/`-`, leaking the
 * remaining entropy into the log. Replaces the entire token with a
 * fingerprint.
 */
const TOKEN_PATTERN = /tat_[a-z]+_[A-Za-z0-9_\-]+/g

function redact(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (typeof arg === "string") {
      return arg.replace(TOKEN_PATTERN, "tat_<redacted>")
    }
    if (arg && typeof arg === "object") {
      try {
        return JSON.parse(JSON.stringify(arg).replace(TOKEN_PATTERN, "tat_<redacted>"))
      } catch {
        return arg
      }
    }
    return arg
  })
}
