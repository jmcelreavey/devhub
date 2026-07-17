/**
 * Build and apply hunk / line patches for partial staging.
 * Uses `git apply --cached` / `git apply --reverse --cached`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGitRepoAsync, type GitRepoRunResult } from "./git-repo-local";
import { pathFromDiffHeader } from "./repo-git-parsers";

export interface DiffHunk {
  /** 0-based index among hunks in the file diff. */
  index: number;
  header: string;
  /** Lines including the @@ header. */
  lines: string[];
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

export interface ParsedFileDiff {
  /** Raw preamble: diff --git / index / --- / +++ */
  preamble: string[];
  oldPath: string | null;
  newPath: string | null;
  hunks: DiffHunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseFileDiff(raw: string): ParsedFileDiff {
  const lines = raw.split("\n");
  const preamble: string[] = [];
  const hunks: DiffHunk[] = [];
  let i = 0;
  while (i < lines.length && !lines[i]!.startsWith("@@")) {
    preamble.push(lines[i]!);
    i++;
  }

  let oldPath: string | null = null;
  let newPath: string | null = null;
  for (const line of preamble) {
    if (line.startsWith("--- ")) oldPath = pathFromDiffHeader(line);
    if (line.startsWith("+++ ")) newPath = pathFromDiffHeader(line);
  }

  while (i < lines.length) {
    const header = lines[i]!;
    if (!header.startsWith("@@")) {
      i++;
      continue;
    }
    const m = header.match(HUNK_RE);
    if (!m) {
      i++;
      continue;
    }
    const hunkLines = [header];
    i++;
    while (i < lines.length && !lines[i]!.startsWith("@@") && !lines[i]!.startsWith("diff ")) {
      hunkLines.push(lines[i]!);
      i++;
    }
    // Drop trailing empty line that split() may add
    while (hunkLines.length > 1 && hunkLines[hunkLines.length - 1] === "") {
      hunkLines.pop();
    }
    hunks.push({
      index: hunks.length,
      header,
      lines: hunkLines,
      oldStart: Number(m[1]),
      oldCount: m[2] !== undefined ? Number(m[2]) : 1,
      newStart: Number(m[3]),
      newCount: m[4] !== undefined ? Number(m[4]) : 1,
    });
  }

  return { preamble, oldPath, newPath, hunks };
}

function ensurePreamble(preamble: string[], filePath: string): string[] {
  const hasDiff = preamble.some((l) => l.startsWith("diff "));
  const hasOld = preamble.some((l) => l.startsWith("--- "));
  const hasNew = preamble.some((l) => l.startsWith("+++ "));
  if (hasDiff && hasOld && hasNew) return preamble;

  const out = [...preamble];
  if (!hasDiff) out.unshift(`diff --git a/${filePath} b/${filePath}`);
  if (!hasOld) out.push(`--- a/${filePath}`);
  if (!hasNew) out.push(`+++ b/${filePath}`);
  return out;
}

/** Recount @@ header from hunk body lines (excluding the header itself). */
export function recountHunkHeader(bodyLines: string[], oldStart: number, newStart: number): string {
  let oldCount = 0;
  let newCount = 0;
  for (const line of bodyLines) {
    if (line.startsWith("+")) newCount++;
    else if (line.startsWith("-")) oldCount++;
    else if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    else {
      // context (leading space or empty)
      oldCount++;
      newCount++;
    }
  }
  const oldPart = oldCount === 1 ? `${oldStart}` : `${oldStart},${oldCount}`;
  const newPart = newCount === 1 ? `${newStart}` : `${newStart},${newCount}`;
  return `@@ -${oldPart} +${newPart} @@`;
}

/**
 * Build a patch for a whole hunk (or a subset of change lines within it).
 * `selectedBodyIndexes` are indexes into hunk.lines (0 = @@ header) — only add/del
 * lines listed are kept; others become context or are dropped appropriately.
 */
export function buildHunkPatch(
  fileDiff: ParsedFileDiff,
  hunkIndex: number,
  filePath: string,
  selectedBodyIndexes?: number[],
): string | null {
  const hunk = fileDiff.hunks[hunkIndex];
  if (!hunk) return null;

  const preamble = ensurePreamble(fileDiff.preamble, filePath);
  let body: string[];

  if (!selectedBodyIndexes || selectedBodyIndexes.length === 0) {
    body = hunk.lines;
  } else {
    const selected = new Set(selectedBodyIndexes);
    const rebuilt: string[] = [];
    // skip header at 0
    for (let i = 1; i < hunk.lines.length; i++) {
      const line = hunk.lines[i]!;
      if (line.startsWith("\\")) {
        rebuilt.push(line);
        continue;
      }
      if (line.startsWith("+")) {
        if (selected.has(i)) rebuilt.push(line);
        // unselected additions are omitted (not applied)
        continue;
      }
      if (line.startsWith("-")) {
        if (selected.has(i)) rebuilt.push(line);
        else rebuilt.push(` ${line.slice(1)}`); // keep as context so patch applies
        continue;
      }
      // context
      rebuilt.push(line.startsWith(" ") ? line : ` ${line}`);
    }
    const header = recountHunkHeader(rebuilt, hunk.oldStart, hunk.newStart);
    body = [header, ...rebuilt];
  }

  return [...preamble, ...body, ""].join("\n");
}

function fail(result: GitRepoRunResult, fallback: string): { ok: false; error: string } {
  return {
    ok: false,
    error: result.stderr.trim() || result.stdout.trim() || fallback,
  };
}

export async function applyCachedPatch(
  repoRoot: string,
  patch: string,
  reverse: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tmp = path.join(os.tmpdir(), `devhub-patch-${process.pid}-${Date.now()}.patch`);
  try {
    fs.writeFileSync(tmp, patch.endsWith("\n") ? patch : `${patch}\n`);
    // Prefer a plain apply (normal hunks), then --unidiff-zero, then 3-way as a last resort.
    const attempts: string[][] = [[], ["--unidiff-zero"], ["--3way"]];
    let result: GitRepoRunResult | null = null;
    for (const extraFlags of attempts) {
      result = await runGitRepoAsync(repoRoot, [
        "apply",
        "--cached",
        ...extraFlags,
        ...(reverse ? ["--reverse"] : []),
        "--",
        tmp,
      ]);
      if (result.status === 0) return { ok: true };
    }
    return fail(result!, reverse ? "Unstage hunk failed" : "Stage hunk failed");
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

/** Stage or unstage a hunk (or selected lines) from a unified diff string. */
export async function stageDiffHunk(opts: {
  repoRoot: string;
  /** Full unified diff for the file (staged or unstaged view). */
  rawDiff: string;
  filePath: string;
  hunkIndex: number;
  /** When set, only these indexes into the hunk.lines array (skip 0 = header). */
  lineIndexes?: number[];
  /** true = unstage (reverse apply to index). */
  reverse: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = parseFileDiff(opts.rawDiff);
  const patch = buildHunkPatch(parsed, opts.hunkIndex, opts.filePath, opts.lineIndexes);
  if (!patch) return { ok: false, error: "Hunk not found" };
  return applyCachedPatch(opts.repoRoot, patch, opts.reverse);
}
