import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { schedulerLogFile, tailLines, WAKE_HELPER_LOG } from "@/lib/scheduler-log";

export const dynamic = "force-dynamic";

/**
 * Recent scheduler activity, plus the root wake helper's own log on macOS.
 * `?job=<id>` filters to one job (lines carry the id's first 8 characters);
 * `?lines=` caps the tail (default 200, max 1000).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const params = new URL(req.url).searchParams;
  const raw = Number(params.get("lines") ?? 200);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 1_000) : 200;
  const job = params.get("job")?.trim().slice(0, 8) || undefined;
  const file = schedulerLogFile();

  return NextResponse.json({
    file,
    lines: tailLines(file, limit, job),
    // The helper logs wakes, not jobs, so a per-job view leaves it out.
    helper:
      process.platform === "darwin" && !job
        ? { file: WAKE_HELPER_LOG, lines: tailLines(WAKE_HELPER_LOG, Math.min(limit, 100)) }
        : null,
  });
}, "jobs.log.get");
