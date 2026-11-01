import { tasksWeekly } from "../../../../../../../packages/shared/actions/work";
import { httpAction } from "../../../../lib/actions/http";
import { ensureTasksMigrated, listTaskDays } from "../../../../domains/tasks/storage";
import { buildWeeklyReview } from "../../../../../../../packages/shared/tasks/weekly";
import { localCalendarDateISO } from "../../../../../../../packages/shared/ui-lib/local/calendar-date";
import { withErrorHandler } from "../../../../lib/api-utils";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;


const readWeekly = withErrorHandler(async (request: Request) => {
  const url = new URL(request.url);
  const endParam = url.searchParams.get("end");
  const end = endParam && DATE_RE.test(endParam) ? endParam : localCalendarDateISO();
  await ensureTasksMigrated();
  const review = buildWeeklyReview(listTaskDays(), end);
  return Response.json(review);
}, "tasks.weekly");

export const GET = httpAction(tasksWeekly, {
  input: (request) => ({ end: new URL(request.url).searchParams.get("end") ?? undefined }),
  context: (request) => ({ read: async () => {
    const response = await readWeekly(request);
    return { status: response.status, body: await response.json() };
  } }),
  response: ({ status, body }) => Response.json(body, { status }),
});
