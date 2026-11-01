import { statusLogs } from "../../../../../../../packages/shared/actions/status";
import fs from "node:fs";
import path from "node:path";
import { withErrorHandler } from "../../../../lib/api-utils";
import { parseLogLine } from "../../../../../../../packages/shared/ui-lib/desktop/log-format";
import { desktopLogDir } from "../../../../lib/desktop/runtime-paths";


const SOURCES = ["shell", "sidecar", "renderer"] as const;
type LogSource = (typeof SOURCES)[number];

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

  const logDir = desktopLogDir();
  const lines: string[] = [];
  for (const source of sources) {
    lines.push(...readTail(path.join(logDir, `${source}.log`), 256 * 1024));
  }
  lines.sort();
  const sliced = lines.length > limit ? lines.slice(lines.length - limit) : lines;

  const result = await statusLogs.handler(statusLogs.input.parse({ source: sources.length === 1 ? sources[0] : "all", lines: Math.ceil(limit) }), {
    read: () => ({ logDir, lines: sliced.map(parseLogLine), count: sliced.length }),
  });
  return Response.json(result.data);
}, "status/logs");
