export type InlineSegment = { kind: "text" | "code"; text: string };

// CSI sequences (colours, cursor moves) and OSC sequences (titles, hyperlinks).
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// Some logs lose the ESC byte on the way (`[91m[1mError: [0m`); strip those SGR remnants too.
const BARE_SGR = /\[(?:\d{1,3}(?:;\d{1,3})*)m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "").replace(BARE_SGR, "");
}

/** Split `text` on single-backtick spans. An unmatched backtick stays literal. */
export function splitInlineCode(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let rest = text;
  while (rest) {
    const open = rest.indexOf("`");
    const close = open === -1 ? -1 : rest.indexOf("`", open + 1);
    if (open === -1 || close === -1) {
      segments.push({ kind: "text", text: rest });
      break;
    }
    if (open > 0) segments.push({ kind: "text", text: rest.slice(0, open) });
    const code = rest.slice(open + 1, close);
    segments.push(code ? { kind: "code", text: code } : { kind: "text", text: "``" });
    rest = rest.slice(close + 1);
  }
  return segments;
}

/** A code span worth offering a copy button for: something you would paste into a terminal. */
export function looksLikeCommand(code: string): boolean {
  return /^[a-z][\w.-]*(?: [\w./:=@~-]+)+$/i.test(code.trim()) && !/[()<>{}]/.test(code);
}
