import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { buildBriefingContext } from "@/lib/briefing-context";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" } as const;

// The full briefing context as JSON — this is what the canvas reads as
// window.__BRIEFING__, and what its runtime refresh helper re-fetches.
export const GET = withErrorHandler(async (request: Request) => {
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const context = await buildBriefingContext({ refresh });
  return NextResponse.json({ ok: true, context }, { headers: NO_STORE });
}, "briefing.data");
