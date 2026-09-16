import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";

/**
 * DevHub skills as MCP prompts, plus one workflow prompt.
 *
 * Harnesses surface prompts as slash commands (Claude Code shows
 * `/mcp__devhub__<skill>`), so a skill becomes something you invoke rather than
 * something an agent has to discover and read first.
 *
 * Read from the checkout's skills/ — shared, then vendor, then root installs,
 * first name wins — when the server starts. A new skill appears after the MCP
 * server restarts. Plugin and ai-tools skills live outside REPO_ROOT and are
 * not included; `skills_read` still reaches them.
 */

export interface SkillPromptSource {
  name: string;
  description: string;
  dir: string;
  file: string;
}

const SKILL_FILE = "SKILL.md";
const SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const MAX_DESCRIPTION = 600;

function unquote(value: string): string {
  const quoted =
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
  return quoted ? value.slice(1, -1).replace(/\\"/g, '"') : value;
}

/** `name` and `description` from YAML frontmatter, including `>-` and `|` block scalars. */
export function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return {};
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end < 0) return {};
  const block = lines.slice(1, end);

  const read = (key: string): string | undefined => {
    const index = block.findIndex((line) => line.startsWith(`${key}:`));
    if (index < 0) return undefined;
    const inline = (block[index] ?? "").slice(key.length + 1).trim();
    if (/^[>|][+-]?$/.test(inline)) {
      const body: string[] = [];
      for (const line of block.slice(index + 1)) {
        if (line.trim() && !/^\s/.test(line)) break;
        body.push(line.trim());
      }
      const text = inline.startsWith(">") ? body.filter(Boolean).join(" ") : body.join("\n");
      return text.trim() || undefined;
    }
    return unquote(inline) || undefined;
  };

  return { name: read("name"), description: read("description") };
}

export function listSkillPromptSources(repoRoot: string): SkillPromptSource[] {
  const skillsRoot = path.join(repoRoot, "skills");
  const parents = [path.join(skillsRoot, "shared"), path.join(skillsRoot, "vendor"), skillsRoot];
  const byName = new Map<string, SkillPromptSource>();

  for (const parent of parents) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(parent, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !SLUG.test(entry.name) || byName.has(entry.name)) continue;
      if (parent === skillsRoot && (entry.name === "shared" || entry.name === "vendor")) continue;
      const file = path.join(parent, entry.name, SKILL_FILE);
      let content: string;
      try {
        content = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const description = parseSkillFrontmatter(content).description ?? `DevHub skill ${entry.name}`;
      byName.set(entry.name, {
        name: entry.name,
        description: description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION)}…` : description,
        dir: path.dirname(file),
        file,
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function buildSkillPromptText(source: SkillPromptSource, content: string, task?: string): string {
  const request = task?.trim();
  return [
    `Use the "${source.name}" DevHub skill. Its instructions follow; any files it references are relative to ${source.dir}.`,
    "",
    content.trim(),
    "",
    "---",
    request ? `Task: ${request}` : "Task: apply this skill to what we are working on; ask if the target is unclear.",
  ].join("\n");
}

export function registerSkillPrompts(server: McpServer, ctx: Context): void {
  for (const source of listSkillPromptSources(ctx.repoRoot)) {
    server.registerPrompt(
      source.name,
      {
        title: source.name,
        description: source.description,
        argsSchema: { task: z.string().optional().describe("What to apply the skill to") },
      },
      ({ task }) => {
        // Re-read on use so an edited skill doesn't need a server restart.
        let content: string;
        try {
          content = fs.readFileSync(source.file, "utf8");
        } catch {
          content = `(Could not read ${source.file} — the skill may have been moved or deleted.)`;
        }
        return {
          messages: [{ role: "user", content: { type: "text", text: buildSkillPromptText(source, content, task) } }],
        };
      },
    );
  }
}

// ── agent race verdict ──────────────────────────────────────────────────────

const RUN_ID_RE = /^run-[a-z0-9-]+$/;

/** Comma-separated run ids → validated list. The MCP-side regex matches agents.ts. */
export function parseRaceRunIds(raw: string): { runIds: string[]; error?: string } {
  const runIds = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (runIds.length < 2) return { runIds, error: "Give at least two run ids, comma-separated (from agent_race or agent_runs)." };
  const invalid = runIds.filter((id) => !RUN_ID_RE.test(id));
  if (invalid.length > 0) return { runIds, error: `Not valid run ids: ${invalid.join(", ")}` };
  return { runIds };
}

export function buildRaceVerdictPrompt(runIds: string[], taskRef?: string): string {
  const linkLine = taskRef?.trim()
    ? `4. Link the verdict note to ${taskRef.trim()} via entity links (they live in a "## Links" section; notes_create_task / tasks_update maintain them).`
    : "4. If a related task or note exists, mention that it should be linked via entity links.";
  const steps = [
    "Compare the finished agent race runs and record a verdict.",
    "",
    "Steps:",
    `1. Diff every run before judging: ${runIds.map((id) => `agent_diff("${id}")`).join(", ")}.`,
    "2. For each run compare: what changed (diff stat + patch), the run's result state, cost/turns, and how well the changes match the original task.",
    '3. Decide a winner (or "none — all unsuitable") and say why in two or three sentences.',
    "5. Write the verdict with notes_write to a path like race-verdicts/<yyyy-mm-dd>-<slug>: per-run sections (provider, diff stat, result, cost, assessment) plus a final recommendation.",
    `6. Run ids compared: ${runIds.join(", ")}.`,
    linkLine,
  ];
  return steps.join("\n");
}

/** Race verdict: agent_diff every run, pick a winner, write the note. */
export function registerRaceVerdictPrompt(server: McpServer): void {
  server.registerPrompt(
    "agent_race_verdict",
    {
      title: "Agent race verdict",
      description:
        "Compare finished agent_race runs (agent_diff each), decide a winner, and write a structured verdict note. Args: runIds (comma-separated), taskRef (optional task/note to link).",
      argsSchema: {
        runIds: z.string().describe("Comma-separated run ids, e.g. run-x1,run-x2,run-x3"),
        taskRef: z.string().optional().describe("Task or note ref to link the verdict to (e.g. task-2026-09-14)"),
      },
    },
    ({ runIds, taskRef }) => {
      const parsed = parseRaceRunIds(runIds);
      const text = parsed.error
        ? `Cannot build the race verdict: ${parsed.error}`
        : buildRaceVerdictPrompt(parsed.runIds, taskRef);
      return { messages: [{ role: "user", content: { type: "text", text } }] };
    },
  );
}
