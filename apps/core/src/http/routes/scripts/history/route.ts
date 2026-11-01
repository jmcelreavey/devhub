import fs from "node:fs";
import { runHistoryFile } from "../../../../lib/runs/history-path";
import { httpAction } from "../../../../lib/actions/http";
import { scriptsHistory } from "../../../../../../../packages/shared/actions/scripts";

interface RunEntry {
  runId: string;
  script: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
}

export async function GET(req?: Request) {
  return httpAction(scriptsHistory, {
    input: () => ({}),
    context: () => ({ read: async () => {
      const logPath = runHistoryFile();
      if (!fs.existsSync(logPath)) return { ok: true, value: [] };
      const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
      const entries: RunEntry[] = lines.slice(-50).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean) as RunEntry[];
      return { ok: true, value: entries.reverse() };
    } }),
    response: (result) => result.ok ? Response.json(result.value) : Response.json({ error: result.error }, { status: result.status }),
  })(req ?? new Request("http://localhost/api/scripts/history"));
}
