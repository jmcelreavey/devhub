import { NextResponse } from "next/server";
import fs from "node:fs";
import { runHistoryFile } from "@/lib/run-history-path";

interface RunEntry {
  runId: string;
  script: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
}

export async function GET() {
  const logPath = runHistoryFile();
  if (!fs.existsSync(logPath)) return NextResponse.json([]);

  const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
  const entries: RunEntry[] = lines.slice(-50).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean) as RunEntry[];

  return NextResponse.json(entries.reverse());
}
