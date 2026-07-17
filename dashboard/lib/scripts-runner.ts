/**
 * Dispatches "actions" (formerly shell/python scripts) to in-process TS
 * implementations and tracks their progress so the SSE stream can push
 * lines to the browser.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getRepoRoot, getHome } from "./notes-dir";
import { syncSkills, verifySync } from "./sync-skills";
import { syncAgents } from "./sync-agents";
import { syncPersona } from "./sync-persona";
import { collectSkills } from "./collect-skills";
import { collectAgents } from "./collect-agents";
import { syncMcpServers } from "./sync-mcp";
import { collectMcpServers } from "./collect-mcp";
import { syncOpencodeConfig } from "./sync-opencode-config";
import { collectOpencodeConfig } from "./collect-opencode-config";
import { collectPersona, type PersonaSource } from "./collect-persona";
import { CONTENT_SYNC_PATHS } from "./content-sync-paths";
import {
  commitAndPushDirty,
  commitAndPushPaths,
  dryRunScopedSync,
  pushUnpushedCommits,
  updateAndSync,
} from "./sync-orchestrator";
import { validateRepo } from "./validate";
import { pullCore } from "./pull-core";
import { runDigest } from "./capability/digest";

type Emit = (line: string) => void;

/** Optional args for POST /api/scripts (subset of actions). */
export interface RunScriptOptions {
  excludeSkills?: string[];
  skills?: string[];
  excludeAgents?: string[];
  agents?: string[];
  /** sync_skills / sync_agents / sync_mcp_servers: true = delete entries missing from repo. Default false. */
  prune?: boolean;
  /** collect_local_skills: copy only these slugs from ~/.…/skills (explicit picks). */
  importSkillNames?: string[];
  importAgentNames?: string[];
  /** commit_dirty_push: explicit commit message. */
  commitMessage?: string;
  /** sync_mcp_servers / collect_local_mcp_servers: per-server filters. */
  excludeServers?: string[];
  servers?: string[];
  importServerNames?: string[];
  /** collect_local_mcp_servers: `personal` → ~/.config/devhub/mcp-personal/ (not git). */
  importMcpTarget?: "repo" | "personal";
  /** collect_local_persona: which tool to pull from + which sources. */
  personaTool?: string;
  personaSources?: PersonaSource[];
}

interface ActionDef {
  /** Human-friendly label — kept for parity with the previous map. */
  label: string;
  /** What it does, surfaced in the API. */
  description: string;
  timeoutMs: number;
  mutates: boolean;
  effects: string[];
  cmd: string;
  run: (emit: Emit, repoRoot: string, runOpts?: RunScriptOptions) => Promise<number>;
}

export interface ScriptCatalogEntry {
  id: string;
  label: string;
  description: string;
  mutates: boolean;
  effects: string[];
  cmd: string;
}

const ACTIONS: Record<string, ActionDef> = {
  capability_digest: {
    label: "Capability Digest (weekly)",
    description: "Scan repos and write a 'what changed this week' evolution digest.",
    timeoutMs: 300_000,
    mutates: true,
    effects: [
      "Runs the Capability Radar scan across local (and optionally GitHub) repos",
      "Writes a dated snapshot under notes/.cache/capability/",
      "Saves a digest note under notes/learnings/digests/",
    ],
    cmd: "dashboard: runDigest (TypeScript)",
    run: async (emit) => {
      await runDigest({ emit });
      return 0;
    },
  },
  update_and_sync: {
    label: "Update & Sync",
    description: "Pull, sync skills+agents+persona, optionally commit & push.",
    timeoutMs: 300_000,
    mutates: true,
    effects: [
      "git pull --rebase from origin (clean tree only)",
      "Copies skills/shared and agents/shared to local tool dirs",
      "Writes L0/L1 persona into AGENTS.md, tool configs, and Cursor rules",
      "Stages new local skills/agents under shared repo dirs",
      "Creates a sync commit and pushes (clean tree only)",
    ],
    cmd: "dashboard: updateAndSync (TypeScript)",
    run: (emit, repoRoot) => updateAndSync({ emit, repoRoot, push: true }),
  },
  commit_dirty_push: {
    label: "Commit & Push Dirty Files",
    description: "Stage all changes, commit, and push current branch.",
    timeoutMs: 120_000,
    mutates: true,
    effects: [
      "Runs git add -A in this repo",
      "Creates one commit with a message you provide",
      "Pushes to origin on the current branch (main/master only)",
    ],
    cmd: "dashboard: commitAndPushDirty (TypeScript)",
    run: (emit, repoRoot, o) => commitAndPushDirty({ emit, repoRoot, commitMessage: o?.commitMessage }),
  },
  sync_notes_push: {
    label: "Sync Notes (Commit + Push)",
    description: "Commit and push changes under notes/ only.",
    timeoutMs: 120_000,
    mutates: true,
    effects: [
      "Stages only changes under notes/",
      "Creates a notes sync commit with an auto-generated message",
      "Pushes to origin on the current branch (main/master only)",
    ],
    cmd: "dashboard: commitAndPushPaths(notes)",
    run: (emit, repoRoot) =>
      commitAndPushPaths({
        emit,
        repoRoot,
        paths: ["notes"],
        commitMessage: `chore(notes): sync notes ${new Date().toISOString().slice(0, 10)}`,
      }),
  },
  sync_notes_tasks_push: {
    label: "Sync content (Commit + Push)",
    description:
      "Commit and push changes under notes/, collections/ (checklists), tasks/, docs/, and upstarts/ only.",
    timeoutMs: 120_000,
    mutates: true,
    effects: [
      "Stages only changes under notes/, collections/, tasks/, docs/, and upstarts/",
      "Creates a content sync commit with an auto-generated message",
      "Pushes to origin on the current branch (main/master only)",
    ],
    cmd: "dashboard: commitAndPushPaths(content)",
    run: (emit, repoRoot) =>
      commitAndPushPaths({
        emit,
        repoRoot,
        paths: [...CONTENT_SYNC_PATHS],
        commitMessage: `chore(content): sync notes, checklists, tasks, docs, and upstarts ${new Date().toISOString().slice(0, 10)}`,
      }),
  },
  dry_run_scoped_sync: {
    label: "Dry Run Scoped Sync (content)",
    description: "Preview files that would be committed for content sync, without commit or push.",
    timeoutMs: 30_000,
    mutates: false,
    effects: [
      "Lists changed files under notes/, collections/, tasks/, docs/, and upstarts/",
      "Shows the commit message and git commands that would run",
      "Does not stage, commit, or push",
    ],
    cmd: "dashboard: dryRunScopedSync(content)",
    run: (emit, repoRoot) =>
      dryRunScopedSync({
        emit,
        repoRoot,
        paths: [...CONTENT_SYNC_PATHS],
        commitMessage: `chore(content): sync notes, checklists, tasks, docs, and upstarts ${new Date().toISOString().slice(0, 10)}`,
      }),
  },
  push_unpushed_commits: {
    label: "Push Unpushed Commits",
    description: "Push ahead commits on main/master without staging or committing files.",
    timeoutMs: 60_000,
    mutates: true,
    effects: [
      "Fetches origin/<branch> and checks ahead count",
      "Pushes local commits already on HEAD",
      "Does not stage or create commits",
    ],
    cmd: "dashboard: pushUnpushedCommits()",
    run: (emit, repoRoot) => pushUnpushedCommits({ emit, repoRoot }),
  },
  pull_core_preview: {
    label: "Pull Core Updates (Preview)",
    description: "Show new commits from the public core (upstream), without applying anything.",
    timeoutMs: 60_000,
    mutates: false,
    effects: [
      "Fetches the public core (upstream remote)",
      "Lists incoming commits and a diff stat since your last pull",
      "Applies nothing, commits nothing — read-only",
    ],
    cmd: "scripts/devhub-update.sh --dry-run",
    run: (emit, repoRoot) => pullCore({ emit, repoRoot, dryRun: true }),
  },
  pull_core: {
    label: "Pull Core Updates",
    description: "Apply new public-core changes onto your mirror, then validate + sync.",
    timeoutMs: 300_000,
    mutates: true,
    effects: [
      "Fetches the public core (upstream remote)",
      "Ports new upstream changes onto your mirror via git apply --3way (no rebase)",
      "Commits the applied changes and advances the sync marker",
      "Runs validate + asset sync afterward",
      "Requires main/master and a tree with no non-personal uncommitted changes",
    ],
    cmd: "scripts/devhub-update.sh",
    run: (emit, repoRoot) => pullCore({ emit, repoRoot }),
  },
  validate: {
    label: "Validate",
    description: "Repo integrity checks (skills, persona, notes, MCP configs).",
    timeoutMs: 60_000,
    mutates: false,
    effects: ["Inspects skills, MCP configs, notes layout. Writes nothing."],
    cmd: "dashboard: validateRepo (TypeScript)",
    run: (emit, repoRoot) => validateRepo({ emit, repoRoot }),
  },
  verify_sync: {
    label: "Verify Sync Health",
    description: "Check that all synced skills are readable in every tool directory.",
    timeoutMs: 30_000,
    mutates: false,
    effects: ["Reads skill files across tool dirs. Writes nothing."],
    cmd: "dashboard: verifySync (TypeScript)",
    run: async (emit, repoRoot) => {
      const r = await verifySync({ emit, repoRoot });
      return r.missing.length + r.unreadable.length > 0 ? 1 : 0;
    },
  },
  sync_skills: {
    label: "Sync Skills",
    description: "Push skills/shared/ + ai-tools upstream → local tool skill dirs, optional prune.",
    timeoutMs: 60_000,
    mutates: true,
    effects: [
      "Refreshes ai-tools upstream skills cache when configured",
      "Overwrites local tool skills from DevHub and ai-tools catalog",
      "Optional prune removes tool-dir skill folders not in the merged catalog",
    ],
    cmd: "dashboard: syncSkills (TypeScript)",
    run: (emit, repoRoot, o) =>
      syncSkills({
        emit,
        repoRoot,
        prune: o?.prune === true,
        skills: o?.skills?.length ? o.skills : undefined,
        excludeSkills: o?.excludeSkills,
      }),
  },
  sync_agents: {
    label: "Sync Agents",
    description: "Push agents/shared/ → local tool agent dirs, optional prune.",
    timeoutMs: 60_000,
    mutates: true,
    effects: [
      "Overwrites local tool agents from the repo",
      "Optional prune removes tool-dir agent files not in agents/shared",
    ],
    cmd: "dashboard: syncAgents (TypeScript)",
    run: (emit, repoRoot, o) =>
      syncAgents({
        emit,
        repoRoot,
        prune: o?.prune === true,
        agents: o?.agents?.length ? o.agents : undefined,
        excludeAgents: o?.excludeAgents,
      }),
  },
  sync_native_persona: {
    label: "Sync Persona",
    description: "Inject persona between markers in each tool's config.",
    timeoutMs: 60_000,
    mutates: true,
    effects: [
      "Updates AGENTS.md (repo + ~/.codex + ~/.opencode)",
      "Updates ~/.claude/CLAUDE.md, ~/.cursor/.cursorrules, and ~/.cursor/rules/devhub-persona-*.mdc",
    ],
    cmd: "dashboard: syncPersona (TypeScript)",
    run: (emit, repoRoot) => syncPersona({ emit, repoRoot }),
  },
  collect_local_skills: {
    label: "Collect Skills",
    description: "Reverse-sync local skills into skills/shared/.",
    timeoutMs: 60_000,
    mutates: true,
    effects: [
      "Copies local skills into skills/shared",
      "Stages collected files for review",
    ],
    cmd: "dashboard: collectSkills (TypeScript)",
    run: (emit, repoRoot, o) =>
      collectSkills({
        emit,
        repoRoot,
        excludeSkills: o?.excludeSkills,
        importSkillNames: o?.importSkillNames?.length ? o.importSkillNames : undefined,
      }),
  },
  collect_local_agents: {
    label: "Collect Agents",
    description: "Reverse-sync local agents into agents/shared/.",
    timeoutMs: 60_000,
    mutates: true,
    effects: [
      "Copies local agent markdown into agents/shared",
      "Stages collected files for review",
    ],
    cmd: "dashboard: collectAgents (TypeScript)",
    run: (emit, repoRoot, o) =>
      collectAgents({
        emit,
        repoRoot,
        excludeAgents: o?.excludeAgents,
        importAgentNames: o?.importAgentNames?.length ? o.importAgentNames : undefined,
      }),
  },
  sync_mcp_servers: {
    label: "Sync MCP Servers",
    description: "Push mcp/shared/ → ~/.{tool} MCP configs, optional prune.",
    timeoutMs: 60_000,
    mutates: true,
    effects: [
      "Overwrites local MCP configs from mcp/shared",
      "Optional prune removes local entries not in repo",
    ],
    cmd: "dashboard: syncMcpServers (TypeScript)",
    run: (emit, repoRoot, o) =>
      syncMcpServers({
        emit,
        repoRoot,
        prune: o?.prune === true,
        servers: o?.servers?.length ? o.servers : undefined,
        excludeServers: o?.excludeServers,
      }),
  },
  collect_local_mcp_servers: {
    label: "Collect MCP Servers",
    description: "Reverse-sync local MCP servers into mcp/shared/.",
    timeoutMs: 60_000,
    mutates: true,
    effects: [
      "Collects local MCP server configs into mcp/shared",
      "Stages collected files for review",
    ],
    cmd: "dashboard: collectMcpServers (TypeScript)",
    run: (emit, repoRoot, o) =>
      collectMcpServers({
        emit,
        repoRoot,
        excludeServers: o?.excludeServers,
        importServerNames: o?.importServerNames?.length ? o.importServerNames : undefined,
        importTarget: o?.importMcpTarget,
      }),
  },
  sync_opencode_config: {
    label: "Sync OpenCode Config",
    description: "Push opencode/shared/opencode.json → ~/.config/opencode/opencode.json (model/provider/theme), resolving {env:VAR} secrets.",
    timeoutMs: 60_000,
    mutates: true,
    effects: [
      "Overwrites model/small_model/provider/theme in the local OpenCode config",
      "Resolves {env:VAR} provider keys from the environment (1Password-backed)",
      "Leaves the mcp block and any other OpenCode keys untouched",
    ],
    cmd: "dashboard: syncOpencodeConfig (TypeScript)",
    run: (emit, repoRoot) => syncOpencodeConfig({ emit, repoRoot }),
  },
  collect_opencode_config: {
    label: "Collect OpenCode Config",
    description: "Reverse-sync local OpenCode model/provider/theme into opencode/shared/opencode.json, scrubbing secrets.",
    timeoutMs: 60_000,
    mutates: true,
    effects: [
      "Imports curated keys from the local OpenCode config into the repo",
      "Replaces resolved secrets with {env:VAR}; refuses raw API keys",
      "Stages the collected file for review",
    ],
    cmd: "dashboard: collectOpencodeConfig (TypeScript)",
    run: (emit, repoRoot) => collectOpencodeConfig({ emit, repoRoot }),
  },
  collect_local_persona: {
    label: "Collect Persona",
    description: "Pull persona/identity blocks from a tool's config back into persona/.",
    timeoutMs: 30_000,
    mutates: true,
    effects: [
      "Reads selected tool config and extracts persona blocks",
      "Writes persona files in the repo",
    ],
    cmd: "dashboard: collectPersona (TypeScript)",
    run: (emit, repoRoot, o) => {
      if (!o?.personaTool) {
        emit("ERROR: personaTool is required.");
        return Promise.resolve(1);
      }
      return collectPersona({
        emit,
        repoRoot,
        tool: o.personaTool,
        sources: o.personaSources,
      });
    },
  },
};

export type AllowedScript = keyof typeof ACTIONS;

interface RunState {
  runId: string;
  script: AllowedScript;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
  lines: string[];
  subscribers: Set<(line: string) => void>;
}

/** Full run output returned by GET /api/scripts/runs/[runId] (live or from disk). */
export interface RunLogPayload {
  runId: string;
  script: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
  lines: string[];
}

const MAX_PERSISTED_LINES = 8_000;

const runs = new Map<string, RunState>();
const running = new Set<AllowedScript>();

export function getAllowedScripts(): AllowedScript[] {
  return Object.keys(ACTIONS) as AllowedScript[];
}

export function getScriptCatalog(): ScriptCatalogEntry[] {
  return (Object.entries(ACTIONS) as [AllowedScript, ActionDef][])
    .map(([id, def]) => ({
      id,
      label: def.label,
      description: def.description,
      mutates: def.mutates,
      effects: def.effects,
      cmd: def.cmd,
    }));
}

export function isRunning(script: AllowedScript): boolean {
  return running.has(script);
}

export function isAnyScriptRunning(): boolean {
  return running.size > 0;
}

export function getRun(runId: string): RunState | undefined {
  return runs.get(runId);
}

function writeAuditLog(run: RunState): void {
  try {
    const stateDir = path.join(/*turbopackIgnore: true*/ getHome(), ".local/state/devhub");
    fs.mkdirSync(stateDir, { recursive: true });
    const entry =
      JSON.stringify({
        runId: run.runId,
        script: run.script,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        exitCode: run.exitCode,
      }) + "\n";
    fs.appendFileSync(path.join(stateDir, "runs.jsonl"), entry);
  } catch {
    /* non-fatal */
  }
}

function persistRunLogToDisk(run: RunState): void {
  try {
    const stateDir = path.join(/*turbopackIgnore: true*/ getHome(), ".local/state/devhub");
    const logsDir = path.join(stateDir, "run-logs");
    fs.mkdirSync(logsDir, { recursive: true });
    let lines = run.lines;
    if (lines.length > MAX_PERSISTED_LINES) {
      const dropped = lines.length - MAX_PERSISTED_LINES;
      lines = [`[truncated ${dropped} earlier line(s)]`, ...lines.slice(-MAX_PERSISTED_LINES)];
    }
    const payload: RunLogPayload = {
      runId: run.runId,
      script: run.script,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      exitCode: run.exitCode,
      lines,
    };
    fs.writeFileSync(path.join(logsDir, `${run.runId}.json`), JSON.stringify(payload), "utf-8");
  } catch {
    /* non-fatal */
  }
}

/** Live buffer or persisted JSON under ~/.local/state/devhub/run-logs/<runId>.json */
export function getRunLogPayload(runId: string): RunLogPayload | null {
  const live = runs.get(runId);
  if (live) {
    return {
      runId: live.runId,
      script: live.script,
      startedAt: live.startedAt,
      finishedAt: live.finishedAt,
      exitCode: live.exitCode,
      lines: live.lines,
    };
  }
  const filePath = path.join(/*turbopackIgnore: true*/ getHome(), ".local/state/devhub/run-logs", `${runId}.json`);
  if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf-8")) as unknown;
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.runId !== "string" || !Array.isArray(o.lines)) return null;
    return {
      runId: o.runId,
      script: typeof o.script === "string" ? o.script : "unknown",
      startedAt: typeof o.startedAt === "number" ? o.startedAt : 0,
      finishedAt: typeof o.finishedAt === "number" ? o.finishedAt : undefined,
      exitCode: typeof o.exitCode === "number" ? o.exitCode : undefined,
      lines: o.lines.map((l) => (typeof l === "string" ? l : String(l))),
    };
  } catch {
    return null;
  }
}

export function startRun(
  script: AllowedScript,
  runOpts?: RunScriptOptions,
): { runId: string } | { error: string } {
  if (!ACTIONS[script]) return { error: "Unknown script" };
  if (running.size > 0) {
    const existing = [...runs.values()].find((r) => r.exitCode === undefined);
    const tag = existing ? `${existing.script} / ${existing.runId}` : "unknown";
    return { error: `Another action is already running (${tag}).` };
  }

  const runId = randomUUID();
  const def = ACTIONS[script];
  const repoRoot = getRepoRoot();

  const run: RunState = {
    runId,
    script,
    startedAt: Date.now(),
    lines: [],
    subscribers: new Set(),
  };
  runs.set(runId, run);
  running.add(script);

  const emit: Emit = (line: string) => {
    const text = line.endsWith("\n") ? line.slice(0, -1) : line;
    if (!text) return;
    run.lines.push(text);
    for (const sub of run.subscribers) sub(text);
  };

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    emit("[TIMEOUT] Action exceeded time limit");
  }, def.timeoutMs);

  void def
    .run(emit, repoRoot, runOpts)
    .then((code) => (timedOut ? 124 : code))
    .catch((err) => {
      emit(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    })
    .then((code) => {
      clearTimeout(timer);
      running.delete(script);
      run.finishedAt = Date.now();
      run.exitCode = code ?? 1;
      emit(`[EXIT] ${run.exitCode}`);
      for (const sub of run.subscribers) sub("[DONE]");
      writeAuditLog(run);
      persistRunLogToDisk(run);
      setTimeout(() => runs.delete(runId), 3_600_000);
    });

  return { runId };
}
