import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { withErrorHandler } from "@/lib/api-utils";
import { getNotesDir } from "@/lib/content-dirs";
import { blocksToText, textToBlocks } from "@/lib/markdown-convert";
import {
  GOAL_STATUSES,
  parseEntries,
  parseGoals,
  skeleton,
  subjectYearPath,
  THEME_LABELS,
  upsertGoal,
  yearOf,
  type GoalStatus,
  type ParsedEntry,
  type ParsedGoal,
  type Theme,
} from "@shared/appraisal/index.ts";

interface YearPayload {
  year: number;
  path: string;
  exists: boolean;
  goals: ParsedGoal[];
  entries: ParsedEntry[];
  coverage: { theme: Theme; label: string; count: number }[];
  markdownExport: string;
}

function yearAbs(year: number): string {
  return path.join(getNotesDir(), "appraisal", "self", `${year}.json`);
}

function readSelfYear(year: string): { rel: string; md: string; exists: boolean } {
  const rel = subjectYearPath("self", year);
  const abs = path.join(getNotesDir(), `${rel}.json`);
  if (!fs.existsSync(abs)) {
    return { rel, md: skeleton("self", year), exists: false };
  }
  const raw = JSON.parse(fs.readFileSync(abs, "utf-8")) as unknown;
  const blocks = Array.isArray(raw) ? raw : [];
  return { rel, md: blocksToText(blocks), exists: true };
}

function writeSelfYear(relWithoutExt: string, md: string): void {
  const abs = path.join(getNotesDir(), `${relWithoutExt}.json`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(textToBlocks(md), null, 2));
}

function buildExport(year: number, goals: ParsedGoal[], entries: ParsedEntry[]): string {
  const lines: string[] = [`# Self-appraisal ${year}`, ""];
  lines.push("## Goals", "");
  for (const g of goals) {
    lines.push(`- **${g.title}** (${g.status})`);
    if (g.detail) lines.push(`  - ${g.detail}`);
  }
  lines.push("", "## Evidence by theme", "");
  for (const theme of Object.keys(THEME_LABELS) as Theme[]) {
    const themed = entries.filter((e) => e.theme === theme);
    if (!themed.length) continue;
    lines.push(`### ${THEME_LABELS[theme]}`, "");
    for (const e of themed) {
      lines.push(`- **${e.title}** (${e.date})`);
      lines.push(`  - ${e.body.split("\n")[0] ?? ""}`);
      if (e.tags?.length) lines.push(`  - tags: ${e.tags.join(", ")}`);
    }
    lines.push("");
  }
  lines.push("## Artifact coverage", "");
  lines.push(`- Goals: ${goals.length}`);
  lines.push(`- Entries: ${entries.length}`);
  lines.push(`- With goal link: ${entries.filter((e) => e.goal).length}`);
  return lines.join("\n");
}

function yearPayload(year: number): YearPayload {
  const abs = yearAbs(year);
  const rel = `appraisal/self/${year}.json`;
  if (!fs.existsSync(abs)) {
    return {
      year,
      path: rel,
      exists: false,
      goals: [],
      entries: [],
      coverage: (Object.keys(THEME_LABELS) as Theme[]).map((t) => ({
        theme: t,
        label: THEME_LABELS[t],
        count: 0,
      })),
      markdownExport: `# Self-appraisal ${year}\n\n_No entries yet._\n`,
    };
  }

  const raw = JSON.parse(fs.readFileSync(abs, "utf-8")) as unknown;
  const blocks = Array.isArray(raw) ? raw : [];
  const md = blocksToText(blocks);
  const goals = parseGoals(md);
  const entries = parseEntries(md);
  const coverage = (Object.keys(THEME_LABELS) as Theme[]).map((theme) => ({
    theme,
    label: THEME_LABELS[theme],
    count: entries.filter((e) => e.theme === theme).length,
  }));

  return {
    year,
    path: rel,
    exists: true,
    goals,
    entries,
    coverage,
    markdownExport: buildExport(year, goals, entries),
  };
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam ? Number(yearParam) : new Date().getFullYear();
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }
  return NextResponse.json(yearPayload(year));
}, "appraisal/year");

interface GoalBody {
  year?: number | string;
  title?: string;
  detail?: string;
  status?: string;
  revision?: string;
  id?: string;
}

/** Create or revise a goal — same write path as MCP `appraisal_set_goal`. */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const body = (await req.json()) as GoalBody;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const yearRaw =
    body.year != null ? String(body.year) : req.nextUrl.searchParams.get("year") ?? undefined;
  const year = yearOf(yearRaw);
  const statusRaw = typeof body.status === "string" ? body.status.trim() : undefined;
  const status =
    statusRaw && (GOAL_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as GoalStatus)
      : undefined;

  const { rel, md } = readSelfYear(year);
  const result = upsertGoal(md, {
    title,
    detail: typeof body.detail === "string" ? body.detail.trim() || undefined : undefined,
    status,
    revision: typeof body.revision === "string" ? body.revision.trim() || undefined : undefined,
    id: typeof body.id === "string" ? body.id.trim() || undefined : undefined,
  });
  writeSelfYear(rel, result.md);

  return NextResponse.json({
    ok: true,
    created: result.created,
    slug: result.slug,
    path: `${rel}.json`,
    year: Number(year),
    goals: parseGoals(result.md),
  });
}, "appraisal/year:goal");
