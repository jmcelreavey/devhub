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

/** Run a DevHub-managed upstart script (cwd should already be the target repo). */
export function repoUpstartCommand(upstartPath: string): string {
  return `bash ${shellQuote(upstartPath)}`;
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

export async function agentRepoUpstartCommand(
  repoName: string,
  upstartPath: string,
  context?: string,
): Promise<string> {
  const cli = await activeAgentCliSpec();
  const prompt = `Use devhub-repo-upstart. Create ${upstartPath} for ${repoName} in the DevHub private store (not .devhub/ in the target repo). Must run nvm use if .nvmrc, refresh deps, and start dev env. Do not just print instructions. Exit; terminal runs the script with cwd=${repoName}.${upstartContextSuffix(context)}`;
  return guardedCliCommand(
    cli.binary,
    `${cli.run(prompt)} && bash ${shellQuote(upstartPath)}`,
    cli.missing("generate the DevHub upstart script (or create it manually under upstarts/)"),
  );
}

export async function agentRepoUpstartUpdateCommand(
  repoName: string,
  upstartPath: string,
  context: string,
): Promise<string> {
  const cli = await activeAgentCliSpec();
  const prompt = `Use devhub-repo-upstart. Update ${upstartPath} for ${repoName} in the DevHub private store (not .devhub/ in the target repo). Must refresh deps, prefer nvm use, start dev env, and preserve correct bits. Exit; terminal runs the script.${upstartContextSuffix(context)}`;
  return guardedCliCommand(
    cli.binary,
    `${cli.run(prompt)} && bash ${shellQuote(upstartPath)}`,
    cli.missing("update the DevHub upstart script (or edit it manually under upstarts/)"),
  );
}

export async function agentRepoUpstartDebugCommand(
  repoName: string,
  upstartPath: string,
  context?: string,
): Promise<string> {
  const cli = await activeAgentCliSpec();
  const prompt = `Use devhub-repo-upstart. Debug/update ${repoName} upstart at ${upstartPath} (DevHub private store, not .devhub/ in the target repo). Ask what failed, keep one-command startup.${upstartContextSuffix(context)}`;
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

export interface StashConflictLaunchOptions {
  repoName: string;
  /** Branch switched to when the conflict came from checkout + stash pop. */
  branch?: string;
  conflictFiles?: string[];
}

/**
 * Interactive agent session to resolve stash/checkout conflicts. Uses
 * `interactive` (not one-shot) so the agent can ask when intent is ambiguous.
 * Prompt stays short — PTY input is ~1024 bytes on macOS.
 */
export async function agentStashConflictCommand(opts: StashConflictLaunchOptions): Promise<string> {
  const cli = await activeAgentCliSpec();
  const files = (opts.conflictFiles ?? []).slice(0, 8);
  const filePart = files.length > 0 ? ` Conflicted files: ${files.join(", ")}.` : "";
  const more =
    (opts.conflictFiles?.length ?? 0) > files.length
      ? ` (+${(opts.conflictFiles!.length - files.length)} more — check git status).`
      : "";
  const branchPart = opts.branch
    ? ` after switching to ${opts.branch}`
    : " after applying a stash";
  const prompt = [
    `Use the git-conflict-resolve skill.`,
    `Resolve stash conflicts in ${opts.repoName}${branchPart}.${filePart}${more}`,
    `Stage resolved files; do not commit unless asked.`,
  ].join(" ");
  return guardedCliCommand(
    cli.binary,
    cli.interactive(prompt),
    cli.missing("resolve stash conflicts from the terminal"),
  );
}

export interface GitHookFailureLaunchOptions {
  repoName: string;
  hook?: string;
  phase: "commit" | "amend" | "push" | "other";
  /** Repo-relative path written by the API (e.g. `.git/devhub-hook-failure.log`). */
  logPath?: string;
}

/**
 * Interactive agent session to fix a failing git hook. Short prompt for PTY
 * ~1024 byte limits — full output lives in the log file when available.
 */
export async function agentGitHookFailureCommand(
  opts: GitHookFailureLaunchOptions,
): Promise<string> {
  const cli = await activeAgentCliSpec();
  const hook = opts.hook ?? "git hook";
  const logHint = opts.logPath
    ? ` Failure output: ${opts.logPath}.`
    : " Re-run the failing git command or hook to see the output.";
  const prompt = [
    `Use the git-hook-fix skill.`,
    `Fix the failing ${hook} in ${opts.repoName} (blocked ${opts.phase}).${logHint}`,
    `Get the hook to pass; do not skip hooks (--no-verify / DEVHUB_SKIP_VERIFY) unless asked.`,
  ].join(" ");
  return guardedCliCommand(
    cli.binary,
    cli.interactive(prompt),
    cli.missing("fix failing git hooks from the terminal"),
  );
}

/**
 * One-shot: draft a conventional commit message from the staged diff and print it.
 * Short prompt for PTY limits — agent inspects `git diff --cached` itself.
 */
export async function agentCommitMessageCommand(repoName: string): Promise<string> {
  const cli = await activeAgentCliSpec();
  const prompt = [
    `In ${repoName}, inspect git diff --cached and print one conventional commit message.`,
    `Subject ≤72 chars, imperative, no quotes or fences. Do not commit.`,
  ].join(" ");
  return guardedCliCommand(
    cli.binary,
    cli.run(prompt),
    cli.missing("draft commit messages from the terminal"),
  );
}

/**
 * One-shot: draft a short stash description from the working-tree diff and print it.
 */
export async function agentStashMessageCommand(repoName: string): Promise<string> {
  const cli = await activeAgentCliSpec();
  const prompt = [
    `In ${repoName}, inspect git status and git diff HEAD, then print one short stash description.`,
    `One line ≤72 chars, plain language, no quotes or fences. Do not stash or commit.`,
  ].join(" ");
  return guardedCliCommand(
    cli.binary,
    cli.run(prompt),
    cli.missing("draft stash messages from the terminal"),
  );
}

export interface DiffSelectionLaunchOptions {
  repoName: string;
  filePath: string;
  snippet: string;
  lineHint?: string;
  context?: string;
  staged?: boolean;
}

/**
 * Interactive agent session seeded with a diff selection + optional user context.
 * Keeps the prompt short for macOS PTY ~1024 byte limits — huge selections point
 * at the file instead of pasting the whole blob.
 */
export async function agentDiffSelectionCommand(
  opts: DiffSelectionLaunchOptions,
): Promise<string> {
  const cli = await activeAgentCliSpec();
  const side = opts.staged ? "staged" : "unstaged";
  const ctx = opts.context?.trim();
  const ctxPart = ctx
    ? ` User context: ${ctx.length > 280 ? `${ctx.slice(0, 280)}...` : ctx}`
    : "";
  const snippet = opts.snippet.trim();
  const maxSnippet = 320;
  const snippetPart =
    snippet.length > maxSnippet
      ? ` Selection is large (${snippet.length} chars, ${opts.lineHint ?? "see file"}) — open ${opts.filePath} and inspect the ${side} diff.`
      : ` Selection (${opts.lineHint ?? "diff"}):\n${snippet}`;
  const prompt = [
    `In ${opts.repoName}, help with a ${side} diff selection in ${opts.filePath}.`,
    snippetPart,
    ctxPart,
    " Ask if intent is unclear. Do not commit unless asked.",
  ]
    .filter(Boolean)
    .join("");
  return guardedCliCommand(
    cli.binary,
    cli.interactive(prompt),
    cli.missing("discuss this diff selection from the terminal"),
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
