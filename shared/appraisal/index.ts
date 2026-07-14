/**
 * Self-appraisal helpers — pure markdown surgery for the appraisal_* tools.
 *
 * A year file is stored as BlockNote JSON like every other note, but authored
 * and edited as Markdown via the shared textToBlocks/blocksToText pipeline.
 * Because that round-trip strips blank lines and renders one block per line,
 * every operation here is line-based and deterministic — no NLP, no blank-line
 * separators. Entries and goals are anchored by hidden HTML-comment markers
 * (`<!-- id: slug -->` / `<!-- goal: slug -->`) which survive the round-trip as
 * plain paragraph text, so update-in-place is a reliable string operation.
 */

export const THEMES = ["impact", "technical", "collaboration", "growth"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  impact: "Impact",
  technical: "Technical",
  collaboration: "Collaboration",
  growth: "Growth",
};

export const GOAL_STATUSES = ["active", "revised", "dropped", "achieved"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export interface EntryInput {
  title: string;
  theme: Theme;
  summary: string;
  references: string[];
  goal?: string;
  tags?: string[];
  date?: string;
  id?: string;
}

export interface GoalInput {
  title: string;
  detail?: string;
  status?: GoalStatus;
  revision?: string;
  id?: string;
}

export interface ParsedGoal {
  slug: string;
  title: string;
  status: GoalStatus;
  set: string;
  updated: string;
  detail?: string;
  revisions: string[];
}

export interface ParsedEntry {
  slug: string;
  title: string;
  theme: Theme;
  date: string;
  body: string;
  goal?: string;
  tags: string[];
}

// ── Primitives ──────────────────────────────────────────────────────

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "untitled";
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Resolve a year from a bare year ("2026"), a date ("2026-06-17"), or undefined (current year). */
export function yearOf(dateOrYear: string | undefined): string {
  const d = (dateOrYear ?? today()).slice(0, 4);
  return /^\d{4}$/.test(d) ? d : today().slice(0, 4);
}

/** Subject 'self' → appraisal/self/<year>; anything else → appraisal/people/<slug>/<year>. */
export function subjectYearPath(subject: string | undefined, year: string): string {
  const s = (subject ?? "self").trim();
  if (s === "" || s.toLowerCase() === "self") return `appraisal/self/${year}`;
  return `appraisal/people/${slugify(s)}/${year}`;
}

export function isSelf(subject: string | undefined): boolean {
  const s = (subject ?? "self").trim().toLowerCase();
  return s === "" || s === "self";
}

function fileTitle(subject: string | undefined, year: string): string {
  if (isSelf(subject)) return `Self-Appraisal ${year}`;
  return `Appraisal: ${(subject as string).trim()} ${year}`;
}

// ── Skeleton ────────────────────────────────────────────────────────

export function skeleton(subject: string | undefined, year: string): string {
  const lines = [`# ${fileTitle(subject, year)}`, "## Goals"];
  for (const t of THEMES) lines.push(`## ${THEME_LABELS[t]}`);
  return lines.join("\n");
}

// ── Rendering ───────────────────────────────────────────────────────

export function renderEntry(input: EntryInput, slug: string): string[] {
  const date = input.date ?? today();
  const refs = `Refs: ${input.references.join(", ")}`;
  const lines = [`### ${input.title}`, `${date} — ${input.summary} ${refs}`.trim()];

  const metaParts: string[] = [];
  if (input.goal) metaParts.push(`Goal: ${input.goal}`);
  if (input.tags && input.tags.length > 0) {
    metaParts.push(`Tags: ${input.tags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ")}`);
  }
  if (metaParts.length > 0) lines.push(metaParts.join(" · "));

  lines.push(`<!-- id: ${slug} -->`);
  return lines;
}

export function renderGoal(goal: ParsedGoal): string[] {
  const lines = [
    `### ${goal.title}`,
    `Status: ${goal.status} · set ${goal.set} · updated ${goal.updated}`,
  ];
  if (goal.detail) lines.push(goal.detail);
  for (const r of goal.revisions) lines.push(r);
  lines.push(`<!-- goal: ${goal.slug} -->`);
  return lines;
}

// ── Section / block location ────────────────────────────────────────

const ENTRY_MARKER = (slug: string) => `<!-- id: ${slug} -->`;
const GOAL_MARKER = (slug: string) => `<!-- goal: ${slug} -->`;

function markerIndex(lines: string[], marker: string): number {
  return lines.findIndex((l) => l.trim() === marker);
}

/** Range [start,end] of a block: from its `### ` heading up to and including its marker line. */
function blockRange(lines: string[], markerLine: number): { start: number; end: number } {
  let start = markerLine;
  while (start >= 0 && !lines[start].startsWith("### ")) start--;
  return { start, end: markerLine };
}

/** Index of the `## <label>` section heading, or -1. */
function sectionHeading(lines: string[], label: string): number {
  return lines.findIndex((l) => l.trim() === `## ${label}`);
}

/** Label of the `## ` section that contains the line at idx, or "". */
function sectionLabelAt(lines: string[], idx: number): string {
  for (let i = idx; i >= 0; i--) {
    if (lines[i].startsWith("## ")) return lines[i].trim().replace(/^##\s+/, "");
  }
  return "";
}

/** Index just past the end of the section that starts at headingIdx (exclusive). */
function sectionEnd(lines: string[], headingIdx: number): number {
  let i = headingIdx + 1;
  while (i < lines.length && !lines[i].startsWith("## ")) i++;
  return i;
}

function insertUnderSection(lines: string[], label: string, block: string[]): string[] {
  let heading = sectionHeading(lines, label);
  const out = [...lines];
  if (heading === -1) {
    // Section missing (older file) — append the heading at the end.
    out.push(`## ${label}`);
    heading = out.length - 1;
  }
  const end = sectionEnd(out, heading);
  out.splice(end, 0, ...block);
  return out;
}

// ── Goals: parse + upsert ───────────────────────────────────────────

export function goalSlugs(md: string): string[] {
  const out: string[] = [];
  const re = /^<!--\s*goal:\s*(\S+)\s*-->$/;
  for (const line of md.split("\n")) {
    const m = line.trim().match(re);
    if (m) out.push(m[1]);
  }
  return out;
}

export function parseGoals(md: string): ParsedGoal[] {
  const lines = md.split("\n");
  const goals: ParsedGoal[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(/^<!--\s*goal:\s*(\S+)\s*-->$/);
    if (!m) continue;
    const slug = m[1];
    const { start } = blockRange(lines, i);
    const title = lines[start].replace(/^###\s+/, "").trim();
    let status: GoalStatus = "active";
    let set = today();
    let updated = today();
    let detail: string | undefined;
    const revisions: string[] = [];
    for (let j = start + 1; j < i; j++) {
      const t = lines[j].trim();
      const s = t.match(/^Status:\s*(\w+)\s*·\s*set\s*(\S+)\s*·\s*updated\s*(\S+)/);
      if (s) {
        if ((GOAL_STATUSES as readonly string[]).includes(s[1])) status = s[1] as GoalStatus;
        set = s[2];
        updated = s[3];
        continue;
      }
      if (/^Revised\b/.test(t)) {
        revisions.push(t);
        continue;
      }
      if (t) detail = detail ? `${detail} ${t}` : t;
    }
    goals.push({ slug, title, status, set, updated, detail, revisions });
  }
  return goals;
}

export function upsertGoal(md: string, input: GoalInput): { md: string; slug: string; created: boolean } {
  const slug = input.id ? slugify(input.id) : slugify(input.title);
  const lines = md.split("\n");
  const at = markerIndex(lines, GOAL_MARKER(slug));
  const now = today();

  if (at !== -1) {
    const existing = parseGoals(md).find((g) => g.slug === slug)!;
    const updated: ParsedGoal = {
      slug,
      title: input.title || existing.title,
      status: input.status ?? (input.revision ? "revised" : existing.status),
      set: existing.set,
      updated: now,
      detail: input.detail ?? existing.detail,
      revisions: [...existing.revisions],
    };
    if (input.revision) updated.revisions.push(`Revised ${now}: ${input.revision}`);
    const { start, end } = blockRange(lines, at);
    const out = [...lines];
    out.splice(start, end - start + 1, ...renderGoal(updated));
    return { md: out.join("\n"), slug, created: false };
  }

  const goal: ParsedGoal = {
    slug,
    title: input.title,
    status: input.status ?? "active",
    set: now,
    updated: now,
    detail: input.detail,
    revisions: input.revision ? [`Revised ${now}: ${input.revision}`] : [],
  };
  return { md: insertUnderSection(lines, "Goals", renderGoal(goal)).join("\n"), slug, created: true };
}

// ── Entries: parse + upsert ─────────────────────────────────────────

export function parseEntries(md: string): ParsedEntry[] {
  const lines = md.split("\n");
  const out: ParsedEntry[] = [];
  let currentTheme: Theme | null = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const sec = t.match(/^##\s+(.+)$/);
    if (sec) {
      const label = sec[1].trim();
      currentTheme = (Object.keys(THEME_LABELS) as Theme[]).find((k) => THEME_LABELS[k] === label) ?? null;
      continue;
    }
    const m = t.match(/^<!--\s*id:\s*(\S+)\s*-->$/);
    if (!m || !currentTheme) continue;
    const slug = m[1];
    const { start } = blockRange(lines, i);
    const title = lines[start].replace(/^###\s+/, "").trim();
    let date = "";
    let body = "";
    let goal: string | undefined;
    let tags: string[] = [];
    for (let j = start + 1; j < i; j++) {
      const line = lines[j].trim();
      const meta = line.match(/^(Goal:|Tags:)/);
      if (meta) {
        const g = line.match(/Goal:\s*(\S+)/);
        if (g) goal = g[1];
        const tg = line.match(/Tags:\s*(.+)$/);
        if (tg) tags = tg[1].split(/\s+/).filter(Boolean);
        continue;
      }
      const d = line.match(/^(\d{4}-\d{2}-\d{2})\s*—\s*(.*)$/);
      if (d) {
        date = d[1];
        body = d[2];
      } else if (line) {
        body = body ? `${body} ${line}` : line;
      }
    }
    out.push({ slug, title, theme: currentTheme, date, body, goal, tags });
  }
  return out;
}

export function entrySlugs(md: string): string[] {
  return parseEntries(md).map((e) => e.slug);
}

export function upsertEntry(md: string, input: EntryInput): { md: string; slug: string; created: boolean } {
  const slug = input.id ? slugify(input.id) : slugify(input.title);
  const block = renderEntry(input, slug);
  const lines = md.split("\n");
  const at = markerIndex(lines, ENTRY_MARKER(slug));

  if (at !== -1) {
    const { start, end } = blockRange(lines, at);
    const targetLabel = THEME_LABELS[input.theme];
    const out = [...lines];

    if (sectionLabelAt(lines, start) === targetLabel) {
      out.splice(start, end - start + 1, ...block); // same theme → update in place
      return { md: out.join("\n"), slug, created: false };
    }
    out.splice(start, end - start + 1); // theme changed → remove, then re-insert
    return { md: insertUnderSection(out, targetLabel, block).join("\n"), slug, created: false };
  }

  return {
    md: insertUnderSection(lines, THEME_LABELS[input.theme], block).join("\n"),
    slug,
    created: true,
  };
}

export function deleteEntry(md: string, slug: string): { md: string; deleted: boolean } {
  const lines = md.split("\n");
  const at = markerIndex(lines, ENTRY_MARKER(slug));
  if (at === -1) return { md, deleted: false };
  const { start, end } = blockRange(lines, at);
  const out = [...lines];
  out.splice(start, end - start + 1);
  return { md: out.join("\n"), deleted: true };
}

// ── Summary length guard ────────────────────────────────────────────

/** Returns a warning string if the summary is too long to stay scannable. */
export function summaryWarning(summary: string): string | null {
  const sentences = summary.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  if (summary.length > 360 || sentences > 3) {
    return "Summary is long; consider tightening to ~1-3 factual sentences.";
  }
  return null;
}
