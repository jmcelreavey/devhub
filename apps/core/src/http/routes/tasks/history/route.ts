import { ensureTasksMigrated, itemsModified, present } from "../../../../domains/tasks/storage";
import { withErrorHandler } from "../../../../lib/api-utils";
import { getActiveTasksDir } from "../../../../lib/notes/dir";
import { todayISO } from "../../../../../../../packages/shared/utils.ts";
import { taskStorage } from "@devhub/core/storage/tasks";
import { taskHistory } from "../../../../../../../packages/shared/actions/tasks";
import { httpAction } from "../../../../lib/actions/http";

export const GET = withErrorHandler(async (req: Request) => {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || undefined;
  const includeTasks = url.searchParams.get("includeTasks") === "1";
  return httpAction(taskHistory, {
    input: () => ({ date, includeTasks }),
    context: () => ({ storage: () => taskStorage(getActiveTasksDir()), prepare: ensureTasksMigrated, today: todayISO, present, modified: () => itemsModified(getActiveTasksDir()) }),
    response: (result) => {
      if (date) return Response.json({ date, tasks: result.days[0]?.tasks ?? [] });
      return Response.json(result.days.map(({ tasks, ...summary }) => includeTasks ? { ...summary, tasks } : summary));
    },
  })(req);
}, "tasks.history");
