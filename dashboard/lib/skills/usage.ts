/**
 * How often each skill was invoked, read from Claude Code session transcripts
 * (`~/.claude/projects/<project>/<session>.jsonl`, plus subagent transcripts
 * nested under `<session>/subagents/`). Skill tool calls land there as
 * `"skill":"<name>"` in the tool input, so a line scan is enough — no JSON parse.
 *
 * Transcripts run to hundreds of MB (single files past 100 MB), so they are
 * streamed line by line: reading them whole would block the dashboard's one
 * event loop and every route with it.
 *
 * Claude Code only: Cursor, Codex and OpenCode don't record skill loads in a
 * readable place, so a zero here means "unused in Claude Code", not unused.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const SKILL_CALL = /"skill"\s*:\s*"([a-z0-9][a-z0-9_:-]{0,80})"/g;
const SKILL_KEY = '"skill"';

export function claudeProjectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

async function transcriptsSince(dir: string, sinceMs: number): Promise<string[]> {
  const found: string[] = [];
  for (const item of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      found.push(...(await transcriptsSince(full, sinceMs)));
    } else if (item.name.endsWith(".jsonl") && (await fs.promises.stat(full)).mtimeMs >= sinceMs) {
      found.push(full);
    }
  }
  return found;
}

async function countInFile(file: string, counts: Map<string, number>): Promise<void> {
  const lines = readline.createInterface({ input: fs.createReadStream(file, "utf-8"), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes(SKILL_KEY)) continue;
    for (const match of line.matchAll(SKILL_CALL)) {
      counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    }
  }
}

/** Invocation counts per skill name for transcripts modified since `sinceMs`. */
export async function countSkillInvocations(
  sinceMs: number,
  projectsDir = claudeProjectsDir(),
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!fs.existsSync(projectsDir)) return counts;

  for (const file of await transcriptsSince(projectsDir, sinceMs)) {
    try {
      await countInFile(file, counts);
    } catch {
      // A transcript being written or rotated mid-scan is skipped, not fatal.
    }
  }
  return counts;
}

export interface SkillUsage {
  skill: string;
  invocations: number;
}

/** Usage for the given skills, least-used first so retirement candidates lead. */
export async function skillUsageFor(
  skills: string[],
  sinceMs: number,
  projectsDir = claudeProjectsDir(),
): Promise<SkillUsage[]> {
  const counts = await countSkillInvocations(sinceMs, projectsDir);
  return skills
    .map((skill) => ({ skill, invocations: counts.get(skill) ?? 0 }))
    .sort((a, b) => a.invocations - b.invocations || a.skill.localeCompare(b.skill));
}
