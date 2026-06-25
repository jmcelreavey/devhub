import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withErrorHandler, parseBody, isSameOrigin } from "@/lib/api-utils";
import {
  readBriefingPrefs,
  saveBriefingPrefs,
  normalisePrefsUpdate,
  type BriefingPrefs,
} from "@/lib/briefing-prefs";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async () => {
  return NextResponse.json({ ok: true, prefs: readBriefingPrefs() });
}, "briefing.prefs");

export const PUT = withErrorHandler(async (request: NextRequest) => {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await parseBody<Record<string, unknown>>(request);
  const patch = normalisePrefsUpdate(body);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields in request body" }, { status: 400 });
  }

  const current = readBriefingPrefs();
  const next: BriefingPrefs = {
    ...current,
    ...patch,
    location: patch.location ?? current.location,
    sections: { ...current.sections, ...(patch.sections ?? {}) },
  };
  await saveBriefingPrefs(next);
  return NextResponse.json({ ok: true, prefs: next });
}, "briefing.prefs");
