import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { buildBriefingContext, readCachedContext } from "@/lib/briefing-context";
import { readBriefingPrefs } from "@/lib/briefing-prefs";
import type { DailyBriefing } from "@/lib/morning-briefing";
import { todayISO } from "@/lib/utils";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;

// Compatibility endpoint for the home-screen widgets (MorningBriefingWidget,
// TodayFocusView) which only need weather + the one-line summary. The bespoke
// /briefing experience uses /api/briefing/data + /api/briefing/canvas instead.
export const GET = withErrorHandler(async (request: Request) => {
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const hadCache = !refresh && !!readCachedContext(todayISO());
  const context = await buildBriefingContext({ refresh });

  const briefing: DailyBriefing = {
    weather: context.weather,
    devTip: null,
    news: context.news,
    events: context.events,
    github: context.github,
    hackerNews: context.hackerNews,
    gaming: context.gaming,
    onThisDay: context.onThisDay,
    aiSummary: null,
    bespokeHtml: null,
    researchCards: context.research,
    interestSnippets: context.interests,
  };

  return NextResponse.json(
    {
      ok: true,
      text: context.summary,
      briefing,
      generatedAt: context.generatedAt,
      cached: hadCache,
      prefs: readBriefingPrefs(),
    },
    { headers: NO_STORE },
  );
}, "dashboard.morning-briefing");
