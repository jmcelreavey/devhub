/**
 * Capture terminal output → notes vault path + markdown.
 * Client-safe: ANSI strip lives in terminal-ansi (no node:*), vault write via fetch.
 */

import { createOrOpenVaultNote } from "@/lib/create-vault-note";
import { localCalendarDateISO } from "@/lib/local/calendar-date";
import { cleanTerminalOutput } from "@/lib/terminal-ansi";

export function terminalCaptureNotePath(labelOrRepo: string, date = localCalendarDateISO()): string {
  const slug = labelOrRepo
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `terminal/${slug || "shell"}-${date}`;
}

/** Fence body so embedded triple-backticks don't break the markdown block. */
export function fenceTerminalCaptureBody(body: string, lang = "text"): string {
  let ticks = "```";
  while (body.includes(ticks)) ticks += "`";
  return `${ticks}${lang}\n${body}\n${ticks}`;
}

export function formatTerminalCaptureMarkdown(opts: {
  label: string;
  cwd?: string;
  sessionId?: string | null;
  body: string;
}): string {
  const cleaned = cleanTerminalOutput(opts.body).trimEnd();
  const meta = [
    opts.cwd ? `- cwd: \`${opts.cwd}\`` : null,
    opts.sessionId ? `- session: \`${opts.sessionId}\`` : null,
    `- captured: ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join("\n");
  return `# Terminal · ${opts.label}\n\n${meta}\n\n${fenceTerminalCaptureBody(cleaned)}\n`;
}

/** Last ~N non-empty lines from a buffer (selection or full scrollback). */
export function lastTerminalBlock(text: string, maxLines = 80): string {
  const lines = text.replace(/\s+$/, "").split("\n");
  if (lines.length <= maxLines) return lines.join("\n");
  return lines.slice(-maxLines).join("\n");
}

export async function saveTerminalCaptureNote(opts: {
  label: string;
  cwd?: string;
  sessionId?: string | null;
  body: string;
  overwrite?: boolean;
}): Promise<{ path: string; href: string; wrote: boolean }> {
  const path = terminalCaptureNotePath(opts.label);
  const markdown = formatTerminalCaptureMarkdown({
    label: opts.label,
    cwd: opts.cwd,
    sessionId: opts.sessionId,
    body: opts.body,
  });
  // Default open-or-create — same-day label path must not silently clobber.
  return createOrOpenVaultNote({ path, markdown, overwrite: opts.overwrite ?? false });
}
