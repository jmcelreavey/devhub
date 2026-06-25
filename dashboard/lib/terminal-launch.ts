"use client";

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

export function opencodeCliCommand(): string {
  return guardedCliCommand(
    "opencode",
    "opencode",
    "OpenCode CLI not found. Use the browser/desktop option or install opencode.",
  );
}

/**
 * One-shot OpenCode review of a PR. Streams the explanation + review into the
 * terminal dock via the `pr-explain-review` skill, then exits. When `notePath`
 * is given (e.g. `pr-reviews/acme-app-1`) the skill also writes the finished
 * review to that DevHub note via the notes MCP, so the dashboard can link to it.
 *
 * The command pins `REPO_ROOT` / `NOTES_DIR` to the DevHub repo so the notes
 * MCP writes into DevHub's `notes/` no matter which repo OpenCode is launched
 * from — without this the review note lands in the wrong place. Guarded so a
 * machine without the opencode CLI prints a hint instead of erroring.
 */
export function opencodeReviewCommand(prUrl: string, notePath?: string): string {
  const parts = [`Use the pr-explain-review skill to explain and review this GitHub PR: ${prUrl}`];
  if (notePath) {
    parts.push(
      `Save the finished write-up as a well-formatted note with the notes MCP (notes_write). Notes MCP path: ${notePath}`,
    );
  }
  const run = `opencode run ${shellQuote(parts.join(" "))}`;

  const repoRoot = (process.env.NEXT_PUBLIC_REPO_ROOT ?? "").trim();
  const command = repoRoot
    ? `REPO_ROOT=${shellQuote(repoRoot)} NOTES_DIR=${shellQuote(`${repoRoot}/notes`)} ${run}`
    : run;

  return guardedCliCommand(
    "opencode",
    command,
    "OpenCode CLI not found. Install opencode to run PR reviews from the terminal.",
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
