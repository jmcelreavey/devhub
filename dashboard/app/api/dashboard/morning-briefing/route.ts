import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { generateText } from "ai";
import { getZAiNotesModel } from "@/lib/z-ai";
import { isNotesAiConfigured } from "@/lib/notes-ai/config";
import { getTodayEvents } from "@/lib/google-calendar";
import { getMyTickets } from "@/lib/jira-client";
import { fetchMyGithubPrs } from "@/lib/github-prs";
import { getTasks, isTaskOpen } from "@/lib/tasks-storage";
import { loadRecentAlerts } from "@/lib/datadog-recent-server";
import { loadOncallStatus } from "@/lib/datadog-oncall-server";
import { buildBriefingPrompt, briefingIsEmpty, type BriefingInput } from "@/lib/morning-briefing";
import { getRepoRoot } from "@/lib/notes-dir";
import { writeAtomic, safeReadJSON } from "@/lib/atomic-write";
import { todayISO, formatTime } from "@/lib/utils";
import { withErrorHandler } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

const STALE_TICKET_DAYS = 7;
const MAX_ITEMS = 5;

interface CachedBriefing {
  date: string;
  text: string;
  generatedAt: string;
}

function cacheFile(date: string): string {
  return path.join(getRepoRoot(), "notes", ".cache", `briefing-${date}.json`);
}

async function settle<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export const GET = withErrorHandler(async (request: Request) => {
  if (!isNotesAiConfigured()) {
    return NextResponse.json({ ok: false, code: "not_configured", message: "Z_AI_API_KEY is not set." });
  }

  const date = todayISO();
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";

  if (!refresh) {
    const cached = safeReadJSON<CachedBriefing | null>(cacheFile(date), null);
    if (cached && cached.date === date) {
      return NextResponse.json({ ok: true, text: cached.text, generatedAt: cached.generatedAt, cached: true });
    }
  }

  const staleBefore = Date.now() - STALE_TICKET_DAYS * 86_400_000;
  const [events, tickets, prs, datadog, oncall] = await Promise.all([
    settle(getTodayEvents(), []),
    settle(getMyTickets(), []),
    settle(fetchMyGithubPrs(), { authored: [], reviews: [] }),
    settle(loadRecentAlerts(MAX_ITEMS), { ok: false } as Awaited<ReturnType<typeof loadRecentAlerts>>),
    settle(loadOncallStatus(), { ok: false } as Awaited<ReturnType<typeof loadOncallStatus>>),
  ]);

  // Only inject on-call noise when this user is actually carrying the pager.
  const onCall = oncall.ok && oncall.onCall;

  const input: BriefingInput = {
    date,
    events: events.map((e) => ({ title: e.title, time: e.isAllDay ? "All day" : formatTime(e.start) })),
    staleTickets: tickets
      .filter((t) => Date.parse(t.updatedAt) < staleBefore)
      .slice(0, MAX_ITEMS)
      .map((t) => ({ key: t.key, summary: t.summary })),
    prsToReview: prs.reviews.slice(0, MAX_ITEMS).map((p) => ({ title: p.title, repo: p.repo })),
    oncallAlerts: onCall && datadog.ok ? datadog.oncall.slice(0, MAX_ITEMS).map((a) => ({ title: a.title })) : [],
    topTasks: getTasks(date).filter(isTaskOpen).slice(0, 3).map((t) => ({ text: t.text })),
  };

  if (briefingIsEmpty(input)) {
    return NextResponse.json({ ok: false, code: "empty", message: "Nothing scheduled or pending — you're clear." });
  }

  const model = getZAiNotesModel();
  if (!model) {
    return NextResponse.json({ ok: false, code: "not_configured", message: "AI model unavailable." });
  }

  const result = await generateText({
    model,
    prompt: buildBriefingPrompt(input),
    // This is a 3–5 sentence summary, not a reasoning task. Disabling GLM's thinking
    // keeps the whole token budget for the answer (reasoning tokens otherwise count
    // against maxOutputTokens and truncate the briefing mid-sentence).
    maxOutputTokens: 512,
    providerOptions: { zai: { thinking: { type: "disabled" } } },
  });

  const generatedAt = new Date().toISOString();
  const trimmed = result.text.trim();
  if (!trimmed) {
    return NextResponse.json({
      ok: false,
      code: "error",
      message: `Model returned an empty briefing (finish: ${result.finishReason}).`,
    });
  }
  if (result.finishReason === "length") {
    return NextResponse.json({
      ok: false,
      code: "error",
      message: "Briefing was truncated (hit the output token limit). Try regenerating.",
    });
  }
  try {
    fs.mkdirSync(path.dirname(cacheFile(date)), { recursive: true });
    await writeAtomic(cacheFile(date), JSON.stringify({ date, text: trimmed, generatedAt } satisfies CachedBriefing));
  } catch {
    // Cache is best-effort.
  }

  return NextResponse.json({ ok: true, text: trimmed, generatedAt, cached: false });
}, "dashboard.morning-briefing");
