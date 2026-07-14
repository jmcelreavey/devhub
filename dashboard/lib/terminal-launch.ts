"use client";

import { getAgentCliConfig, type AgentCliConfig } from "./agent-cli-config";

export interface TerminalLaunchOptions {
  cwd?: string;
  label?: string;
  command?: string;
}

export function openTerminal(options: TerminalLaunchOptions = {}): void {
  window.dispatchEvent(new CustomEvent("devhub:terminal-open", { detail: options }));
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

/**
 * The agent CLI one-shot jobs are handed to, resolved from the env-backed
 * Agent CLI settings (`/api/agent-cli`, see `agent-cli-env.ts`). Both CLIs see
 * the same skills and notes MCP via the sync engine, so prompts are
 * CLI-agnostic. Builders are async because the settings live server-side.
 */
interface AgentCliSpec {
  binary: string;
  label: string;
  /** One-shot: run the prompt, then exit (safe to `&&`-chain). */
  run(prompt: string): string;
  /** Interactive session seeded with the prompt. */
  interactive(prompt: string): string;
  /** Message printed when the binary is missing; `action` completes "… to <action>." */
  missing(action: string): string;
}

function agentCliSpec(config: AgentCliConfig): AgentCliSpec {
  if (config.cli === "cursor") {
    const model = shellQuote(config.cursorModel);
    return {
      binary: "cursor-agent",
      label: "Cursor",
      // --force lets print mode actually run commands instead of stalling on
      // approval prompts nobody can answer in a one-shot run; --approve-mcps
      // does the same for MCP servers (an unapproved notes MCP would sit
      // invisible). NOTE: one malformed entry in `~/.cursor/mcp.json` makes
      // cursor-agent silently discard the whole file — sync-mcp.ts's
      // `cursorToTool` keeps entries strictly Cursor-shaped for this reason.
      run: (prompt) => `cursor-agent -p ${shellQuote(prompt)} --force --approve-mcps --model ${model}`,
      interactive: (prompt) => `cursor-agent ${shellQuote(prompt)} --model ${model}`,
      missing: (action) =>
        `Cursor CLI not found. Install cursor-agent (or switch the Agent CLI setting back to OpenCode) to ${action}.`,
    };
  }
  // Blank model → omit the flag so opencode.json's default model applies.
  const modelFlag = config.opencodeModel ? `--model ${shellQuote(config.opencodeModel)} ` : "";
  return {
    binary: "opencode",
    label: "OpenCode",
    run: (prompt) => `opencode run ${modelFlag}${shellQuote(prompt)}`,
    interactive: (prompt) => `opencode ${modelFlag}--prompt ${shellQuote(prompt)}`,
    missing: (action) => `OpenCode CLI not found. Install opencode to ${action}.`,
  };
}

async function activeAgentCliSpec(): Promise<AgentCliSpec> {
  return agentCliSpec(await getAgentCliConfig());
}

export function opencodeCliCommand(): string {
  return guardedCliCommand(
    "opencode",
    "opencode",
    "OpenCode CLI not found. Use the browser/desktop option or install opencode.",
  );
}

export function repoUpstartCommand(): string {
  return "bash .devhub/upstart.sh";
}

function upstartContextSuffix(context?: string): string {
  const trimmed = context?.trim();
  if (!trimmed) return "";
  const compact = trimmed.length > 300 ? `${trimmed.slice(0, 300)}...` : trimmed;
  return ` Context: ${compact}`;
}

/**
 * Pin `REPO_ROOT`/`NOTES_DIR` to the DevHub repo so the notes MCP writes into
 * DevHub's `notes/` no matter which repo the agent is launched from — without
 * this the note lands in the wrong place.
 */
function withDevhubNotesEnv(run: string): string {
  const repoRoot = (process.env.NEXT_PUBLIC_REPO_ROOT ?? "").trim();
  if (!repoRoot) return run;
  return `REPO_ROOT=${shellQuote(repoRoot)} NOTES_DIR=${shellQuote(`${repoRoot}/notes`)} ${run}`;
}

export async function agentRepoUpstartCommand(repoName: string, context?: string): Promise<string> {
  const cli = await activeAgentCliSpec();
  const prompt = `Use devhub-repo-upstart. Create .devhub/upstart.sh for ${repoName}. Must run nvm use if .nvmrc, refresh deps, and start dev env. Do not just print instructions. Exit; terminal runs it.${upstartContextSuffix(context)}`;
  return guardedCliCommand(
    cli.binary,
    `${cli.run(prompt)} && bash .devhub/upstart.sh`,
    cli.missing("generate .devhub/upstart.sh (or create it manually)"),
  );
}

export async function agentRepoUpstartUpdateCommand(repoName: string, context: string): Promise<string> {
  const cli = await activeAgentCliSpec();
  const prompt = `Use devhub-repo-upstart. Update .devhub/upstart.sh for ${repoName}. Must refresh deps, prefer nvm use, start dev env, and preserve correct bits. Exit; terminal runs it.${upstartContextSuffix(context)}`;
  return guardedCliCommand(
    cli.binary,
    `${cli.run(prompt)} && bash .devhub/upstart.sh`,
    cli.missing("update .devhub/upstart.sh (or edit it manually)"),
  );
}

export async function agentRepoUpstartDebugCommand(repoName: string, context?: string): Promise<string> {
  const cli = await activeAgentCliSpec();
  const prompt = `Use devhub-repo-upstart. Debug/update ${repoName} upstart. Inspect .devhub/upstart.sh, ask what failed, keep one-command startup.${upstartContextSuffix(context)}`;
  return guardedCliCommand(
    cli.binary,
    cli.interactive(prompt),
    cli.missing("debug this upstart journey"),
  );
}

/**
 * One-shot agent DX audit of a repo via the `dx-audit` skill. The skill
 * detects the stack, audits dev loop / CI / release / dependency health, and
 * writes the report to DevHub notes (`reviews/dx-audit-<repo>-<date>`) via the
 * notes MCP — `REPO_ROOT`/`NOTES_DIR` are pinned like the review command so the
 * note lands in DevHub's notes no matter which repo the agent runs from.
 */
export async function agentRepoDxAuditCommand(repoName: string, context?: string): Promise<string> {
  const cli = await activeAgentCliSpec();
  const date = new Date().toISOString().slice(0, 10);
  const notePath = `reviews/dx-audit-${repoName}-${date}`;
  const parts = [
    `Use the dx-audit skill to audit developer experience in the ${repoName} repo.`,
    `Write the report to DevHub notes via the notes MCP (notes_write). Notes MCP path: ${notePath}.`,
    `Finish with a terminal summary (verdict + top 5 actions), then exit.`,
  ];
  const trimmed = context?.trim();
  if (trimmed) {
    const compact = trimmed.length > 300 ? `${trimmed.slice(0, 300)}...` : trimmed;
    parts.push(`Live question/context from the user: ${compact}`);
  }
  return guardedCliCommand(
    cli.binary,
    withDevhubNotesEnv(cli.run(parts.join(" "))),
    cli.missing("run DX audits from the terminal"),
  );
}

/**
 * One-shot agent review of a PR. Streams the explanation + review into the
 * terminal dock via the `pr-explain-review` skill, then exits. When `notePath`
 * is given (e.g. `pr-reviews/acme-app-1`) the skill also writes the finished
 * review to that DevHub note via the notes MCP, so the dashboard can link to it.
 *
 * The command pins `REPO_ROOT` / `NOTES_DIR` to the DevHub repo so the notes
 * MCP writes into DevHub's `notes/` no matter which repo the agent is launched
 * from — without this the review note lands in the wrong place. Guarded so a
 * machine without the selected CLI prints a hint instead of erroring.
 */
export async function agentReviewCommand(prUrl: string, notePath?: string): Promise<string> {
  const cli = await activeAgentCliSpec();
  const parts = [`Use the pr-explain-review skill to explain and review this GitHub PR: ${prUrl}`];
  if (notePath) {
    parts.push(
      `Save the finished write-up as a well-formatted note with the notes MCP (notes_write). Notes MCP path: ${notePath}`,
    );
  }
  return guardedCliCommand(
    cli.binary,
    withDevhubNotesEnv(cli.run(parts.join(" "))),
    cli.missing("run PR reviews from the terminal"),
  );
}

/** The plan fields the lab launch command needs (subset of the API's LabPlan). */
export interface LabLaunchPlan {
  signalId: string;
  label: string;
  repoName: string;
}

/**
 * One-shot agent build of a Capability Radar lab via the `capability-lab`
 * skill — the same visible-terminal pattern as PR review. The agent fetches
 * the full plan (repo path, workspace dir, evidence, language, notes path)
 * from the plan URL itself, builds the lab, then registers it via the adopt
 * URL so the dashboard picks it up.
 *
 * Deliberately terse: commands are typed into a canonical-mode PTY, which
 * caps an input line at ~1024 bytes on macOS — a long prompt gets mangled.
 * `REPO_ROOT`/`NOTES_DIR` are pinned like the review command so the note
 * lands in DevHub's notes no matter which repo the agent runs from.
 */
export async function agentLabCommand(plan: LabLaunchPlan, refresh = false): Promise<string> {
  const cli = await activeAgentCliSpec();
  const query = `signalId=${encodeURIComponent(plan.signalId)}&repoName=${encodeURIComponent(plan.repoName)}`;
  const planUrl = `${window.location.origin}/api/capability/journey/plan?${query}`;
  const adoptUrl = `${window.location.origin}/api/capability/journey/adopt`;
  const parts = [
    `Use the capability-lab skill to build a hands-on learning lab for "${plan.label}" (signal id: ${plan.signalId}) in the ${plan.repoName} repo.`,
    `Plan URL (curl for repo path, workspace dir, evidence, language, notes path): ${planUrl}`,
    `Adopt URL: ${adoptUrl}`,
    refresh ? "This is a REBUILD — overwrite the existing note and refresh the starter." : "",
  ].filter(Boolean);
  return guardedCliCommand(
    cli.binary,
    withDevhubNotesEnv(cli.run(parts.join(" "))),
    cli.missing("build labs from the terminal"),
  );
}

export function claudeCliCommand(): string {
  return guardedCliCommand(
    "claude",
    "claude",
    "Claude CLI not found. Use the Claude app option or install Claude Code.",
  );
}

export function guardedCliCommand(binary: string, command: string, missingMessage: string): string {
  return `if command -v ${shellQuote(binary)} >/dev/null 2>&1; then ${command}; else printf '%s\\n' ${shellQuote(missingMessage)}; fi`;
}
