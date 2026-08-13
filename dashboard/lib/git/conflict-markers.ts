export interface ConflictHunk {
  start: number;
  end: number;
  ours: string;
  base: string | null;
  theirs: string;
}

export type ConflictChoice = "ours" | "base" | "theirs" | "both";

interface LinePart {
  text: string;
  start: number;
  end: number;
}

export function parseConflictHunks(content: string): ConflictHunk[] {
  const lines: LinePart[] = [];
  const linePattern = /[^\n]*\n|[^\n]+$/g;
  for (const match of content.matchAll(linePattern)) {
    lines.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }

  const hunks: ConflictHunk[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i]!.text.startsWith("<<<<<<< ")) continue;
    const start = lines[i]!.start;
    let separator = -1;
    let baseMarker = -1;
    let endMarker = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j]!.text;
      if (line.startsWith("||||||| ") && separator < 0) baseMarker = j;
      else if (line.startsWith("=======") && separator < 0) separator = j;
      else if (line.startsWith(">>>>>>> ") && separator >= 0) {
        endMarker = j;
        break;
      }
    }
    if (separator < 0 || endMarker < 0) continue;

    const oursEnd = baseMarker >= 0 ? baseMarker : separator;
    hunks.push({
      start,
      end: lines[endMarker]!.end,
      ours: lines.slice(i + 1, oursEnd).map((line) => line.text).join(""),
      base:
        baseMarker >= 0
          ? lines.slice(baseMarker + 1, separator).map((line) => line.text).join("")
          : null,
      theirs: lines.slice(separator + 1, endMarker).map((line) => line.text).join(""),
    });
    i = endMarker;
  }
  return hunks;
}

export function resolveConflictHunk(
  content: string,
  hunk: ConflictHunk,
  choice: ConflictChoice,
): string {
  const replacement =
    choice === "ours"
      ? hunk.ours
      : choice === "theirs"
        ? hunk.theirs
        : choice === "base"
          ? (hunk.base ?? "")
          : hunk.ours + hunk.theirs;
  return content.slice(0, hunk.start) + replacement + content.slice(hunk.end);
}
