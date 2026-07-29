import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { withErrorHandler } from "@/lib/api-utils";
import { parseLogLine } from "@/lib/desktop/log-format";
import { defaultAppDataDir, getAppDataDir } from "@/lib/desktop/runtime-paths";

export const dynamic = "force-dynamic";

const SOURCES = ["shell", "sidecar", "renderer"] as const;
type LogSource = (typeof SOURCES)[number];

/**
 * Where the desktop shell actually writes. Prefer the OS app-data location —
 * that is what Rust opens — and only fall back to `getAppDataDir()` for the
 * rare case of a checkout that has its own `logs/` (tests, odd setups).
 */
function resolveLogDir(): string {
  const osLogs = path.join(defaultAppDataDir(), "logs");
  if (fs.existsSync(path.join(osLogs, "shell.log"))) return osLogs;
  return path.join(getAppDataDir(), "logs");
}

function readTail(filePath: string, maxBytes: number): string[] {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const stat = fs.fstatSync(fd);
      const size = stat.size;
      if (size === 0) return [];
      const start = Math.max(0, size - maxBytes);
      const length = size - start;
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, start);
      const text = buf.toString("utf8");
      // A mid-line start after a seek is fine — drop the partial first line.
      const lines = text.split("\n");
      if (start > 0 && lines.length > 0) lines.shift();
      return lines.filter((line) => line.length > 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
}

export const GET = withErrorHandler(async (req: Request) => {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("n") ?? 200) || 200, 1), 1000);
  const sourceParam = url.searchParams.get("source") ?? "all";
  const sources: LogSource[] =
    sourceParam === "all"
      ? [...SOURCES]
      : SOURCES.includes(sourceParam as LogSource)
        ? [sourceParam as LogSource]
        : [...SOURCES];

  const logDir = resolveLogDir();
  const lines: string[] = [];
  for (const source of sources) {
    lines.push(...readTail(path.join(logDir, `${source}.log`), 256 * 1024));
  }
  lines.sort();
  const sliced = lines.length > limit ? lines.slice(lines.length - limit) : lines;

  return NextResponse.json({
    logDir,
    lines: sliced.map(parseLogLine),
    count: sliced.length,
  });
}, "status/logs");
