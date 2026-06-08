import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getHome } from "@/lib/notes-dir";

interface RunEntry {
  runId: string;
  script: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
}

export async function GET() {
  const logPath = path.join(getHome(), ".local/state/devhub/runs.jsonl");
  if (!fs.existsSync(logPath)) return NextResponse.json([]);

  const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
  const entries: RunEntry[] = lines.slice(-50).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean) as RunEntry[];

  return NextResponse.json(entries.reverse());
}
