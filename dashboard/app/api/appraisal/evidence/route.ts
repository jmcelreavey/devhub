import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { withErrorHandler } from "@/lib/api-utils";
import { getNotesDir } from "@/lib/content-dirs";
import { getMyTickets } from "@/lib/jira-client";
import { fetchMyGithubPrs } from "@/lib/github-prs";
import type { DatadogRecentAlertsResponse } from "@/lib/datadog-recent-events";
import { blocksToText, textToBlocks } from "@/lib/markdown-convert";
import { clampEvidenceDays } from "@/lib/appraisal-evidence-range";
import {
  skeleton,
  subjectYearPath,
  summaryWarning,
  THEMES,
  upsertEntry,
  yearOf,
  type Theme,
} from "@shared/appraisal/index.ts";

export interface EvidenceSuggestion {
  kind: "pr" | "jira" | "datadog";
  title: string;
  url: string;
  summary: string;
  suggestedTheme: "impact" | "technical" | "collaboration" | "growth";
  date: string;
}

function themeFor(kind: EvidenceSuggestion["kind"], text: string): EvidenceSuggestion["suggestedTheme"] {
  const t = text.toLowerCase();
  if (kind === "datadog" || /incident|outage|on-?call|alert/.test(t)) return "impact";
  if (kind === "pr" || /refactor|fix|perf|type|test/.test(t)) return "technical";
  if (/review|pair|mentor|design|collab/.test(t)) return "collaboration";
  return "growth";
}

function appraisalAbsPath(relWithoutExt: string): string {
  return path.join(getNotesDir(), `${relWithoutExt}.json`);
}

function readAppraisalMd(subject: string | undefined, year: string): { rel: string; md: string } {
  const rel = subjectYearPath(subject, year);
  const abs = appraisalAbsPath(rel);
  if (!fs.existsSync(abs)) {
    return { rel, md: skeleton(subject, year) };
  }
  const raw = JSON.parse(fs.readFileSync(abs, "utf-8")) as unknown;
  const blocks = Array.isArray(raw) ? raw : [];
  return { rel, md: blocksToText(blocks) };
}

function writeAppraisalMd(relWithoutExt: string, md: string): void {
  const abs = appraisalAbsPath(relWithoutExt);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(textToBlocks(md), null, 2));
}

function inRange(isoOrMs: string | number | undefined, sinceMs: number, untilMs: number): boolean {
  if (isoOrMs == null || isoOrMs === "") return true; // keep undated artifacts
  const ms = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(ms)) return true;
  return ms >= sinceMs && ms <= untilMs;
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const days = clampEvidenceDays(sp.get("days") ?? "7");
  const untilMs = (() => {
    const to = sp.get("to");
    if (to) {
      const t = Date.parse(to.length <= 10 ? `${to}T23:59:59.999Z` : to);
      if (Number.isFinite(t)) return t;
    }
    return Date.now();
  })();
  const sinceMs = (() => {
    const from = sp.get("from");
    if (from) {
      const t = Date.parse(from.length <= 10 ? `${from}T00:00:00.000Z` : from);
      if (Number.isFinite(t)) return t;
    }
    return untilMs - days * 86400000;
  })();

  const suggestions: EvidenceSuggestion[] = [];

  try {
    const open = await fetchMyGithubPrs();
    for (const p of [...open.authored, ...open.reviews]) {
      if (!inRange(p.updatedAt, sinceMs, untilMs)) continue;
      suggestions.push({
        kind: "pr",
        title: `${p.repo}#${p.number}`,
        url: p.url,
        summary: p.title,
        suggestedTheme: themeFor("pr", p.title),
        date: (p.updatedAt ?? new Date().toISOString()).slice(0, 10),
      });
    }
  } catch {
    /* optional */
  }

  try {
    const tickets = await getMyTickets();
    for (const t of tickets.slice(0, 40)) {
      if (!inRange(t.updatedAt, sinceMs, untilMs)) continue;
      suggestions.push({
        kind: "jira",
        title: t.key,
        url: t.url,
        summary: t.summary,
        suggestedTheme: themeFor("jira", `${t.summary} ${t.status}`),
        date: t.updatedAt.slice(0, 10),
      });
    }
  } catch {
    /* optional */
  }

  try {
    const base = req.nextUrl.origin;
    const res = await fetch(`${base}/api/datadog/recent-alerts`, {
      headers: { cookie: req.headers.get("cookie") ?? "" },
    });
    if (res.ok) {
      const body = (await res.json()) as DatadogRecentAlertsResponse;
      if (body.ok) {
        for (const ev of [...body.oncall, ...body.teamSlack].slice(0, 20)) {
          if (!inRange(ev.timestampMs, sinceMs, untilMs)) continue;
          suggestions.push({
            kind: "datadog",
            title: ev.title.slice(0, 80),
            url: `${base}/datadog`,
            summary: ev.status ?? "alert",
            suggestedTheme: "impact",
            date: new Date(ev.timestampMs).toISOString().slice(0, 10),
          });
        }
      }
    }
  } catch {
    /* optional */
  }

  return NextResponse.json({
    days,
    from: new Date(sinceMs).toISOString().slice(0, 10),
    to: new Date(untilMs).toISOString().slice(0, 10),
    suggestions: suggestions.slice(0, 40),
  });
}, "appraisal/evidence");

interface RecordBody {
  title?: string;
  theme?: string;
  summary?: string;
  references?: string[];
  date?: string;
  kind?: string;
  subject?: string;
  id?: string;
  tags?: string[];
}

/** Persist a cited artifact into the self (or subject) appraisal year note. */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const body = (await req.json()) as RecordBody;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const themeRaw = typeof body.theme === "string" ? body.theme.trim() : "";
  const references = Array.isArray(body.references)
    ? body.references.filter((r): r is string => typeof r === "string" && r.trim().length > 0)
    : [];
  const theme = (THEMES as readonly string[]).includes(themeRaw) ? (themeRaw as Theme) : null;

  if (!title || !summary || !theme || references.length === 0) {
    return NextResponse.json(
      { error: "title, theme, summary, and at least one reference are required" },
      { status: 400 },
    );
  }

  const date = typeof body.date === "string" && body.date ? body.date : undefined;
  const year = yearOf(date);
  const subject = typeof body.subject === "string" ? body.subject : "self";
  const tags =
    Array.isArray(body.tags) && body.tags.length
      ? body.tags.filter((t): t is string => typeof t === "string")
      : typeof body.kind === "string" && body.kind
        ? [`#${body.kind}`]
        : undefined;

  const { rel, md } = readAppraisalMd(subject, year);
  const result = upsertEntry(md, {
    title,
    theme,
    summary,
    references,
    date,
    id: typeof body.id === "string" ? body.id : undefined,
    tags,
  });
  writeAppraisalMd(rel, result.md);

  const warn = summaryWarning(summary);
  return NextResponse.json({
    ok: true,
    created: result.created,
    slug: result.slug,
    path: `${rel}.json`,
    year: Number(year),
    warning: warn,
  });
}, "appraisal/evidence:record");
