import { requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { readSchedulerLog } from "@devhub/core/scheduler/log";
import { httpAction } from "../../../../lib/actions/http";
import { jobsLog } from "../../../../../../../packages/shared/actions/jobs";


/**
 * Recent scheduler activity, plus the root wake helper's own log on macOS.
 * `?job=<id>` filters to one job (lines carry the id's first 8 characters);
 * `?lines=` caps the tail (default 200, max 1000).
 */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const params = new URL(req.url).searchParams;
  const raw = Number(params.get("lines") ?? 200);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 1_000) : 200;
  const job = params.get("job")?.trim().slice(0, 8) || undefined;
  return httpAction(jobsLog, {
    input: () => ({ job, lines: limit }),
    context: () => ({ read: async (input) => ({ ok: true, value: readSchedulerLog(input) }) }),
    response: (result) => result.ok ? Response.json(result.value) : Response.json({ error: result.error }, { status: result.status }),
  })(req);
}, "jobs.log.get");
