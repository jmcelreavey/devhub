/**
 * Agent command cards + terminal→Agent drag helpers.
 * Client-safe: no node:*.
 */

import { lastTerminalBlock } from "@/lib/terminal/capture";

/** HTML5 DnD type for terminal selection → Agent tab/composer. */
export const TERMINAL_SELECTION_MIME = "application/x-devhub-terminal-selection";
/** Older type — still set so in-flight clients keep working. */
export const TERMINAL_SELECTION_MIME_LEGACY = "application/x-devhub-terminal";

export interface TerminalCommandBlock {
  id: string;
  command: string;
  output: string;
  startedAt: number;
  endedAt?: number;
  pending: boolean;
  /** Exact code from shell integration (OSC 133 D); null when unknown. */
  exitCode?: number | null;
}

const MARKER_CHARS = 4_000;
const OUTPUT_CAP = 24_000;

/** Chromium hides custom MIME on dragover — remember a live terminal drag. */
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
 * A gap is only an RPROMPT separator when it comes *after* the prompt, so
 * anchor on the last prompt glyph and only trim beyond it.
 */
export function stripRightPrompt(line: string): string {
  const trimmed = line.replace(/\s+$/, "");
  let glyphAt = -1;
  for (const match of trimmed.matchAll(PROMPT_GLYPH_RE)) glyphAt = match.index;
  if (glyphAt === -1) return trimmed;
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

/** Extra D param DevHub's own quiet-inject wrapper adds, so it doesn't count as shell integration. */
export const INJECT_EXIT_TAG = "devhub-inject";

export function parseOsc133(payload: string): { kind: "A" | "B" | "C" | "D"; exitCode?: number; inject?: true } | null {
  const [kind, ...rest] = payload.split(";");
  if (kind !== "A" && kind !== "B" && kind !== "C" && kind !== "D") return null;
  // D carries the exit code: `133;D;0`. Anything non-numeric stays undefined.
  if (kind === "D" && rest.length > 0) {
    const code = Number.parseInt(rest[0]!.trim(), 10);
    if (Number.isFinite(code)) return rest[1] === INJECT_EXIT_TAG ? { kind, exitCode: code, inject: true } : { kind, exitCode: code };
  }
  return { kind };
}

/** Read OSC 133 from arbitrary PTY frames without mistaking other control strings for markers. */
export function createOsc133Stream(onMarker: (marker: NonNullable<ReturnType<typeof parseOsc133>>) => void) {
  let state: "text" | "escape" | "osc" | "oscEscape" | "control" | "controlEscape" = "text";
  let payload = "";
  let overflow = false;
  const finish = () => {
    if (!overflow && payload.startsWith("133;")) {
      const marker = parseOsc133(payload.slice(4));
      if (marker) onMarker(marker);
    }
    payload = "";
    overflow = false;
    state = "text";
  };
  return (chunk: string) => {
    for (const ch of chunk) {
      if (ch === "\x18" || ch === "\x1a") {
        payload = "";
        overflow = false;
        state = "text";
      } else if (state === "text") {
        if (ch === "\x1b") state = "escape";
        else if (ch === "\x9d") state = "osc";
        else if ("\x90\x98\x9e\x9f".includes(ch)) state = "control";
      } else if (state === "escape") {
        if (ch === "]") state = "osc";
        else if ("PX^_".includes(ch)) state = "control";
        else state = ch === "\x1b" ? "escape" : "text";
      } else if (state === "osc") {
        if (ch === "\x07" || ch === "\x9c") finish();
        else if (ch === "\x1b") state = "oscEscape";
        else if (payload.length < 512) payload += ch;
        else overflow = true;
      } else if (state === "oscEscape") {
        if (ch === "\\") finish();
        else {
          payload = "";
          overflow = false;
          state = ch === "]" ? "osc" : "text";
        }
      } else if (state === "control") {
        if (ch === "\x9c") state = "text";
        else if (ch === "\x1b") state = "controlEscape";
      } else {
        state = ch === "\\" ? "text" : ch === "\x1b" ? "controlEscape" : "control";
      }
    }
  };
}

export function createOsc133OutputStream(
  write: (text: string) => void,
  onMarker: (marker: NonNullable<ReturnType<typeof parseOsc133>>) => void,
  onReplayMarker: (marker: NonNullable<ReturnType<typeof parseOsc133>>) => void,
) {
  let marker: NonNullable<ReturnType<typeof parseOsc133>> | null = null;
  const parse = createOsc133Stream((value) => { marker = value; });
  return (chunk: string, replay: boolean) => {
    let start = 0;
    for (let index = 0; index < chunk.length; index++) {
      parse(chunk[index]!);
      if (marker) {
        write(chunk.slice(start, index + 1));
        if (replay) onReplayMarker(marker);
        else onMarker(marker);
        marker = null;
        start = index + 1;
      }
    }
    if (start < chunk.length) write(chunk.slice(start));
  };
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
  const one = command.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max)}…`;
}
