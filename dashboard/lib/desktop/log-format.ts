/**
 * Parse a desktop shell log line.
 *
 * Format written by `DesktopLog::write_line`:
 *   `[unix_ms=1712345678901][shell:startup] message`
 */
export function parseLogLine(raw: string): {
  raw: string;
  timestampMs: number | null;
  source: string;
  message: string;
} {
  const match = raw.match(/^\[unix_ms=(\d+)\]\[([^\]]+)\]\s?(.*)$/);
  if (!match) {
    return { raw, timestampMs: null, source: "unknown", message: raw };
  }
  return {
    raw,
    timestampMs: Number(match[1]),
    source: match[2] ?? "unknown",
    message: match[3] ?? "",
  };
}

/** Local wall-clock time for a log line. Returns empty string when unknown. */
export function formatLogTime(timestampMs: number | null): string {
  if (timestampMs === null || !Number.isFinite(timestampMs)) return "";
  const d = new Date(timestampMs);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
