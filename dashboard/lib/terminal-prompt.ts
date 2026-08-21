/**
 * Warp-ish prompt helpers — client-safe, no node:*.
 * NL → one shell command, fence extract, last-command chips.
 */

export const PROMPT_ASK_SYSTEM =
  "You write one shell command for a developer terminal. Reply with only the command. No explanation. No markdown unless the command is multi-line, then a single fenced block.";

export interface AgentWorkflowChip {
  id: string;
  label: string;
  /** Fill the composer; user sends. */
  draft: string;
}

export function looksLikeShellCommand(text: string): boolean {
  const line = text.trim();
  if (!line) return false;
  if (line.includes("\n")) return false;
  if (/^(please|can you|what|why|how|explain|review|summarize|tell me)\b/i.test(line)) {
    return false;
  }
  if (/^[./~]/.test(line) || line.startsWith("sudo ")) return true;
  const first = line.split(/\s+/)[0] ?? "";
  return /^(ls|cd|pwd|echo|printf|true|false|cat|head|tail|rg|grep|find|git|npm|npx|pnpm|yarn|bun|cargo|go|python|pip|make|curl|wget|ssh|scp|docker|kubectl|brew|node|tsx|vitest|sed|awk|chmod|chown|ps|kill|lsof|jq|gh)\b/.test(
    first,
  );
}

/** Pull a runnable command out of a model reply (fenced or raw). */
export function extractShellCommand(reply: string): string | null {
  const text = reply.trim();
  if (!text) return null;
  const fenced = text.match(/```(?:bash|sh|zsh|shell|console)?\s*\n([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? text).trim();
  if (!body) return null;
  const lines = body
    .split("\n")
    .map((l) => l.replace(/^\s*\$\s*/, "").trimEnd())
    .filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (lines.length === 0) return null;
  const command = lines.join("\n").trim();
  return command.length > 4000 ? `${command.slice(0, 4000)}…` : command;
}

export function extractRunnableCommands(markdown: string): string[] {
  const out: string[] = [];
  const re = /```(?:bash|sh|zsh|shell)\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown))) {
    const cmd = extractShellCommand(match[0]);
    if (cmd) out.push(cmd);
  }
  return out.slice(0, 4);
}

export function previewPromptCommand(command: string, max = 72): string {
  const one = command.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max)}…`;
}

export function agentWorkflows(ctx: {
  cwd?: string;
  repoName?: string;
  lastBlock?: string;
}): AgentWorkflowChip[] {
  const where = ctx.repoName || ctx.cwd?.split("/").filter(Boolean).pop() || "this repo";
  const last = ctx.lastBlock?.trim();
  return [
    {
      id: "review",
      label: "Review this PR",
      draft: `Review the current PR in ${where}.`,
    },
    {
      id: "error",
      label: "Explain last error",
      draft: last
        ? `Explain this terminal output. Be terse.\n\n\`\`\`\n${last.slice(0, 6000)}\n\`\`\``
        : "Explain the last error in the terminal.",
    },
    {
      id: "ran",
      label: "What just ran?",
      draft: last
        ? `What did this command do?\n\n\`\`\`\n${last.slice(0, 4000)}\n\`\`\``
        : "What did the last command do?",
    },
  ];
}
