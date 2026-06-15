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
