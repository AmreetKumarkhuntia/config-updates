// Server-only, zero-dependency colorized logger.
// Lives under src/lib/server/ so SvelteKit never bundles it to the browser.
// Output: `[HH:MM:SS.mmm] LEVEL (scope) message key=val key=val`
// Colors auto-disable when stdout is not a TTY or NO_COLOR is set; the
// threshold is controlled by LOG_LEVEL (debug|info|warn|error, default info).

import { env } from "$env/dynamic/private";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveThreshold(): number {
  const raw = env.LOG_LEVEL?.trim().toLowerCase();
  if (raw && raw in LEVEL_ORDER) return LEVEL_ORDER[raw as LogLevel];
  return LEVEL_ORDER.info;
}

// Resolved once at module load. The dev server restarts on env changes anyway.
const threshold = resolveThreshold();

// Disable ANSI when piped to a file / non-TTY, or when NO_COLOR is set.
const useColor =
  !process.env.NO_COLOR && !!process.stdout && process.stdout.isTTY === true;

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
} as const;

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: ANSI.dim,
  info: ANSI.blue,
  warn: ANSI.yellow,
  error: ANSI.red,
};

function paint(color: string, text: string): string {
  return useColor ? `${color}${text}${ANSI.reset}` : text;
}

/** Clean, single-line message from an unknown catch value. */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function timestamp(): string {
  // HH:MM:SS.mmm in local time.
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(
    d.getMilliseconds(),
    3,
  )}`;
}

function renderValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value == null
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Render structured fields as `key=value` pairs. An `err` field is normalized
 * to a `message` pair (and a `stack` pair at debug level).
 */
function renderFields(
  level: LogLevel,
  fields: Record<string, unknown> | undefined,
): string {
  if (!fields) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key === "err" && value != null) {
      parts.push(`message=${renderValue(errMsg(value))}`);
      if (level === "debug" && value instanceof Error && value.stack) {
        parts.push(`stack=${renderValue(value.stack)}`);
      }
      continue;
    }
    if (value === undefined) continue;
    parts.push(`${key}=${renderValue(value)}`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** Returns a logger with a nested "parent:child" scope. */
  child(scope: string): Logger;
}

function emit(
  scope: string,
  level: LogLevel,
  msg: string,
  fields?: Record<string, unknown>,
): void {
  if (LEVEL_ORDER[level] < threshold) return;

  const ts = paint(ANSI.gray, `[${timestamp()}]`);
  const tag = paint(LEVEL_COLOR[level], level.toUpperCase().padEnd(5));
  const scopeText = paint(ANSI.cyan, `(${scope})`);
  const line = `${ts} ${tag} ${scopeText} ${msg}${renderFields(level, fields)}`;

  // warn/error → stderr, everything else → stdout.
  if (level === "warn" || level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export function createLogger(scope: string): Logger {
  return {
    debug: (msg, fields) => emit(scope, "debug", msg, fields),
    info: (msg, fields) => emit(scope, "info", msg, fields),
    warn: (msg, fields) => emit(scope, "warn", msg, fields),
    error: (msg, fields) => emit(scope, "error", msg, fields),
    child: (childScope) => createLogger(`${scope}:${childScope}`),
  };
}
