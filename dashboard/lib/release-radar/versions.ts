/**
 * Version-range comparison, scoped to the one question Release Radar asks.
 *
 * ## Why not depend on `semver`
 *
 * `semver` is the right library for resolving what a range *matches* — a real
 * satisfiability problem over an install tree. That is not this question. This
 * asks "which major line has each repo committed to", which needs only the
 * leading number of a range, and answering it does not justify a dependency
 * in a project whose recall layer already refused a 90 MB embedding model on
 * the same reasoning.
 *
 * The cost is being explicit about what this cannot do, which is the section
 * below rather than a surprise later.
 *
 * ## What this deliberately does not handle
 *
 * - **Ranges with no single major line** (`*`, `>=1`, `1 || 2`, `latest`) return
 *   `null`. They are unresolvable *by construction*, not parse failures, so they
 *   are reported as unpinned rather than guessed at.
 * - **Protocol ranges** (`workspace:*`, `file:../x`, `npm:foo@^1`, git URLs)
 *   return `null`. A workspace link is not a version decision.
 * - **Pre-1.0 packages.** `^0.3.0` and `^0.4.0` are breaking-incompatible under
 *   npm's caret rules despite sharing major 0, so the effective line for `0.x`
 *   is `0.<minor>` — otherwise every 0.x package looks falsely aligned.
 */

/** A comparable "major line": `18`, or `0.4` for pre-1.0 packages. */
export type MajorLine = string;

const PROTOCOL_RE = /^(?:workspace|file|link|npm|git|github|http|https|portal):/i;
const NUMERIC_HEAD_RE = /^\s*[\^~>=<]*\s*v?(\d+)(?:\.(\d+))?/;

/**
 * The major line a range commits to, or null when it commits to none.
 *
 * Union and wildcard ranges return null rather than their first branch: a repo
 * declaring `1 || 2` has not chosen, and reporting it as "on 1" would invent a
 * decision to disagree with.
 */
export function majorLine(range: string): MajorLine | null {
  const value = range.trim();
  if (!value) return null;
  if (PROTOCOL_RE.test(value)) return null;
  if (value === "*" || value === "x" || value.toLowerCase() === "latest") return null;
  if (value.includes("||")) return null;

  // Comparator ranges split two ways. `>=2.0.0 <3` is bounded on both sides and
  // commits to line 2 as clearly as `^2.0.0` does. A bare `>=1` is open-ended —
  // it admits every future major, so it names no line and resolving it to the
  // lower bound would invent a commitment the author declined to make.
  if (/^\s*[<>]=?/.test(value)) {
    const hasUpperBound = /<\s*v?\d/.test(value);
    const hasLowerBound = />=?\s*v?\d/.test(value);
    if (!hasUpperBound || !hasLowerBound) return null;
    const lower = />=?\s*(v?\d[^\s]*)/.exec(value);
    return lower ? majorLine(lower[1]) : null;
  }

  const match = NUMERIC_HEAD_RE.exec(value);
  if (!match) return null;

  const major = Number(match[1]);
  if (!Number.isFinite(major)) return null;

  // Pre-1.0: npm treats ^0.3 and ^0.4 as incompatible, so the minor is part of
  // the line. Without this every 0.x package reads as aligned.
  if (major === 0) {
    const minor = match[2] ?? "0";
    return `0.${minor}`;
  }
  return String(major);
}

/** Sorts major lines newest-first; handles the `0.x` two-part form. */
export function compareMajorLines(a: MajorLine, b: MajorLine): number {
  const parse = (line: MajorLine) => line.split(".").map((n) => Number(n) || 0);
  const [aMajor, aMinor = 0] = parse(a);
  const [bMajor, bMinor = 0] = parse(b);
  if (aMajor !== bMajor) return bMajor - aMajor;
  return bMinor - aMinor;
}

/** How far apart two lines are, in major steps. `0.3` → `0.5` counts as 2. */
export function majorDistance(from: MajorLine, to: MajorLine): number {
  const parse = (line: MajorLine) => line.split(".").map((n) => Number(n) || 0);
  const [fromMajor, fromMinor = 0] = parse(from);
  const [toMajor, toMinor = 0] = parse(to);
  if (fromMajor !== toMajor) return Math.abs(toMajor - fromMajor);
  return Math.abs(toMinor - fromMinor);
}
