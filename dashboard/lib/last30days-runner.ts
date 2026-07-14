import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { getRepoRoot } from "@/lib/notes-dir";
import { interestsNeedingResearch, researchDir } from "@/lib/briefing-research";

export interface Last30DaysRunResult {
  ok: boolean;
  script: string | null;
  saveDir: string;
  requested: string[];
  ran: string[];
  skipped: string[];
  failed: string[];
  output: string[];
}

function expandHome(p: string): string {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

export function resolveLast30DaysScript(): string | null {
  const configured = process.env.LAST30DAYS_SCRIPT?.trim();
  const candidates = [
    configured,
    "~/.claude/skills/last30days/scripts/last30days.py",
    "~/.config/opencode/skills/last30days/scripts/last30days.py",
    "~/.opencode/skills/last30days/scripts/last30days.py",
    "~/.codex/skills/last30days/scripts/last30days.py",
    "~/.cursor/skills/last30days/scripts/last30days.py",
  ].filter(Boolean) as string[];
  return candidates.map(expandHome).find((p) => fs.existsSync(p)) ?? null;
}

function runTopic(script: string, topic: string, saveDir: string, output: string[]): Promise<number> {
  const args = [script, topic, "--save-dir", saveDir];
  const sources = process.env.LAST30DAYS_SOURCES?.trim();
  if (sources) args.push("--search", sources);
  return new Promise((resolve) => {
    const child = spawn("python3", args, { cwd: getRepoRoot(), env: process.env });
    child.stdout.on("data", (chunk) => output.push(String(chunk)));
    child.stderr.on("data", (chunk) => output.push(String(chunk)));
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      output.push(err.message);
      resolve(1);
    });
  });
}

export async function runLast30DaysForInterests(
  interests: string[],
  opts: { onlyMissing?: boolean } = {},
): Promise<Last30DaysRunResult> {
  const requested = [...new Set(interests.map((i) => i.trim()).filter(Boolean))];
  const saveDir = researchDir();
  const output: string[] = [];
  const script = resolveLast30DaysScript();
  const needed = opts.onlyMissing ? interestsNeedingResearch(requested) : requested;
  const skipped = requested.filter((interest) => !needed.includes(interest));

  if (!script) {
    return { ok: false, script: null, saveDir, requested, ran: [], skipped, failed: requested, output: ["Last30Days script not found."] };
  }

  fs.mkdirSync(saveDir, { recursive: true });
  const ran: string[] = [];
  const failed: string[] = [];
  for (const topic of needed) {
    output.push(`==> /last30days ${topic}\n`);
    ran.push(topic);
    const code = await runTopic(script, topic, saveDir, output);
    if (code !== 0) failed.push(topic);
  }

  return { ok: failed.length === 0, script, saveDir, requested, ran, skipped, failed, output: output.slice(-80) };
}
