/**
 * GET/PUT /api/github/prs/auto-review/settings — toggle the in-process auto
 * agent-review poller without editing .env.local.
 *
 * Auth: requireDashboardAuth (same-origin / secret).
 * GET returns `{ enabled, always, source, intervalMs }`.
 * PUT body `{ enabled?: boolean, always?: boolean }` persists prefs and kicks
 * a poller tick so enable takes effect immediately.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import {
  readAutoPrReviewPrefs,
  saveAutoPrReviewPrefs,
} from "@/lib/github/auto-pr-review-prefs";
import {
  autoPrReviewIntervalMs,
  kickAutoPrReviewPoller,
} from "@/lib/github/auto-pr-review-poller";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  enabled: z.boolean().optional(),
  always: z.boolean().optional(),
});

function settingsPayload() {
  const prefs = readAutoPrReviewPrefs();
  return {
    enabled: prefs.enabled,
    always: prefs.always,
    source: prefs.source,
    intervalMs: autoPrReviewIntervalMs(),
  };
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json(settingsPayload());
}, "github.prs.auto-review.settings.get");

export const PUT = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;

  if (parsed.data.enabled === undefined && parsed.data.always === undefined) {
    return NextResponse.json(
      { error: "Provide at least one of enabled or always." },
      { status: 400 },
    );
  }

  const saved = await saveAutoPrReviewPrefs({
    ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
    ...(parsed.data.always !== undefined ? { always: parsed.data.always } : {}),
  });

  kickAutoPrReviewPoller();

  return NextResponse.json({
    enabled: saved.enabled,
    always: saved.always,
    source: saved.source,
    intervalMs: autoPrReviewIntervalMs(),
  });
}, "github.prs.auto-review.settings.put");
