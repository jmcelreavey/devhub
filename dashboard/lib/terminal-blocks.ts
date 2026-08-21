/**
 * Warp-like command blocks + terminal→Agent drag helpers.
 * Client-safe: no node:*.
 */

import { lastTerminalBlock } from "@/lib/terminal-capture";
import { previewPromptCommand } from "@/lib/terminal-prompt";

/** HTML5 DnD type for xterm selection → Agent tab/composer. */
export const TERMINAL_SELECTION_MIME = "application/x-devhub-terminal-selection";
/** Older type — still set so in-flight clients keep working. */
export const TERMINAL_SELECTION_MIME_LEGACY = "application/x-devhub-terminal";

export type TerminalBlockSource = "prompt" | "inject" | "typed" | "osc";

export interface TerminalCommandBlock {
  id: string;
  command: string;
  output: string;
  startedAt: number;
  endedAt?: number;
  source: TerminalBlockSource;
  pending: boolean;
  /** Exact code from shell integration (OSC 133 D); null when unknown. */
  exitCode?: number | null;
  /** Absolute xterm buffer row where the command started — jump target. */
  startLine?: number;
}

const MARKER_CHARS = 4_000;
const OUTPUT_CAP = 24_000;
const MAX_TYPED = 500;

/** Chromium hides custom MIME on dragover — remember a live xterm drag. */
let terminalSelectionDrag = false;
let terminalSelectionText = "";

export function setTerminalSelectionDrag(active: boolean, text = ""): void {
  terminalSelectionDrag = active;
  terminalSelectionText = active ? text : "";
}

export function isTerminalSelectionDrag(): boolean {
  return terminalSelectionDrag;
}

export function newTerminalBlockId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Snapshot the buffer so we can slice output after the command finishes. */
export function terminalBufferMarker(text: string): string {
  if (text.length <= MARKER_CHARS) return text;
  return text.slice(-MARKER_CHARS);
}

/** Output written after `marker` (end of buffer at command start). */
export function sliceNewOutput(marker: string, after: string): string {
  if (!after) return "";
  if (!marker) return after;
  const idx = after.lastIndexOf(marker);
  if (idx >= 0) return after.slice(idx + marker.length);
  return lastTerminalBlock(after, 80);
}

export function stripCommandEcho(command: string, output: string): string {
  const cmd = command.trim();
  if (!cmd || !output) return output;
  const lines = output.split("\n");
  let i = 0;
  while (i < lines.length && !lines[i]!.trim()) i += 1;
  const first = lines[i]?.trim() ?? "";
  if (first === cmd || first.endsWith(cmd)) {
    return lines.slice(i + 1).join("\n").replace(/^\n+/, "");
  }
  return output;
}

export function capBlockOutput(text: string, max = OUTPUT_CAP): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…`;
}

export function parseStructuredExit(output: string): number | null {
  const match = output.match(/── exit (\d+) ──/);
  if (!match) return null;
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : null;
}

export function formatBlockForAgent(block: Pick<TerminalCommandBlock, "command" | "output">): string {
  const out = block.output.replace(/\s+$/, "");
  if (!out) return `$ ${block.command}`;
  return `$ ${block.command}\n${out}`;
}

export function lastNonEmptyLine(text: string): string {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.replace(/\s+$/, "");
    if (line) return line;
  }
  return "";
}

/** Prompt glyphs a theme may end its prompt with. */
const PROMPT_GLYPH_RE = /[\u276f\u279c\u25b6%$#>]/g;

/**
 * Drop a p10k-style RPROMPT (wide gap, then clock/git) from a prompt line.
 *
 * This used to cut at the first run of two-or-more spaces, which assumed the
 * only wide gap on the line was the RPROMPT separator. Icon themes break that
 * badly: a powerlevel10k prompt starts with Nerd Font glyphs and double spaces
 * (U+F179 " " U+F07C "  ~/Developer"), so the cut landed inside the prompt's
 * own icon segment and threw the whole line away. Every caller then concluded
 * there was no prompt on screen, which silently disabled typed-command blocks.
 *
 * A gap is only an RPROMPT separator when it comes *after* the prompt, so
 * anchor on the last prompt glyph and only trim beyond it.
 */
export function stripRightPrompt(line: string): string {
  const trimmed = line.replace(/\s+$/, "");
  let glyphAt = -1;
  for (const match of trimmed.matchAll(PROMPT_GLYPH_RE)) glyphAt = match.index;
  if (glyphAt === -1) {
    // No glyph to anchor on — fall back to the old heuristic.
    return trimmed.replace(/\s{2,}\S[\s\S]*$/, "").replace(/\s+$/, "");
  }
  const head = trimmed.slice(0, glyphAt + 1);
  const tail = trimmed.slice(glyphAt + 1).replace(/\s{2,}\S[\s\S]*$/, "");
  return (head + tail).replace(/\s+$/, "");
}

export function looksLikePromptLine(line: string): boolean {
  const t = stripRightPrompt(line);
  if (!t) return false;
  if (/[❯➜▶]\s*$/.test(t)) return true;
  if (/[%$#>]\s*$/.test(t)) return true;
  return false;
}

/**
 * Command sitting after a prompt glyph on the last line.
 * Used for OSC 133 C (execute) and typed-Enter confirmation.
 */
export function commandFromPromptLine(line: string): string | null {
  const left = stripRightPrompt(line);
  if (!left) return null;
  const match = left.match(/^(?:.*[❯➜▶]|.*[%$#>])\s+(\S.*)$/);
  const rest = match?.[1]?.trim() ?? "";
  if (!rest || rest.length > MAX_TYPED) return null;
  return rest;
}

export function parseOsc133(payload: string): { kind: "A" | "B" | "C" | "D"; exitCode?: number } | null {
  const [kind, ...rest] = payload.split(";");
  if (kind !== "A" && kind !== "B" && kind !== "C" && kind !== "D") return null;
  // D carries the exit code: `133;D;0`. Anything non-numeric stays undefined.
  if (kind === "D" && rest.length > 0) {
    const code = Number.parseInt(rest[0]!.trim(), 10);
    if (Number.isFinite(code)) return { kind, exitCode: code };
  }
  return { kind };
}

/** Compact human duration for block chips: `820ms`, `4.2s`, `2m11s`. */
export function formatBlockDuration(startedAt: number, endedAt?: number): string | null {
  if (!endedAt) return null;
  const ms = Math.max(0, endedAt - startedAt);
  if (ms < 1_000) return `${ms}ms`;
  const s = ms / 1_000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${Math.round(s % 60)}s`;
}

/**
 * Cheap line-editor tracker for typed-in-xterm commands.
 * Resets on CSI/control (arrows, vim) so we don't invent blocks per keystroke.
 * Enter may arrive batched with the command (`ls\r`) — treat that as submit.
 */
export function applyTypedInput(
  accum: string,
  data: string,
): { accum: string; submitted?: string } {
  if (data.startsWith("\x1b") && !data.includes("[200~")) {
    return { accum: "" };
  }
  const cleaned = data.replace(/\x1b\[201?~/g, "");
  let next = accum;
  let submitted: string | undefined;
  for (const ch of cleaned) {
    if (ch === "\r" || ch === "\n") {
      const cmd = next.trimEnd();
      if (cmd) submitted = cmd;
      next = "";
      continue;
    }
    if (ch === "\x7f" || ch === "\b") {
      next = next.slice(0, -1);
      continue;
    }
    if (ch === "\x15") {
      next = "";
      continue;
    }
    if (ch === "\x1b" || (ch < " " && ch !== "\t")) {
      next = "";
      submitted = undefined;
      continue;
    }
    next += ch;
    if (next.length > MAX_TYPED + 80) return { accum: "" };
  }
  return { accum: next, submitted };
}

export function shouldRecordTypedCommand(command: string, lastLine: string): boolean {
  const cmd = command.trim();
  if (!cmd || cmd.length > MAX_TYPED) return false;
  if (cmd.length === 1 && " qGjkhly".includes(cmd)) return false;
  if (/^(please|can you|what|why|how|explain|review|summarize|tell me)\b/i.test(cmd)) {
    return false;
  }
  const line = stripRightPrompt(lastLine);
  if (line.endsWith(cmd)) return true;
  // zsh-autosuggestions paints a greyed completion after the cursor, so the
  // prompt line reads `echo hel` + `lo world` while only `echo hel` was typed.
  // The ghost is always a suffix of what is on screen, so a prefix match is
  // the honest test — an exact match alone dropped the block entirely.
  const onPrompt = commandFromPromptLine(line);
  if (onPrompt && onPrompt.startsWith(cmd)) return true;
  return looksLikePromptLine(line);
}

export function dataTransferHasTerminalSelection(dt: DataTransfer): boolean {
  if (terminalSelectionDrag) return true;
  const types = Array.from(dt.types);
  if (types.includes("Files")) return false;
  return (
    types.includes(TERMINAL_SELECTION_MIME) ||
    types.includes(TERMINAL_SELECTION_MIME_LEGACY) ||
    types.includes("text/plain") ||
    types.includes("Text")
  );
}

export function readTerminalSelection(dt: DataTransfer): string {
  const custom =
    dt.getData(TERMINAL_SELECTION_MIME).replace(/\s+$/, "") ||
    dt.getData(TERMINAL_SELECTION_MIME_LEGACY).replace(/\s+$/, "");
  if (custom) return custom;
  const plain = (dt.getData("text/plain") || dt.getData("Text") || "").replace(/\s+$/, "");
  if (plain) return plain;
  return terminalSelectionText.replace(/\s+$/, "");
}

export function previewBlockCommand(command: string, max = 42): string {
  return previewPromptCommand(command, max);
}
