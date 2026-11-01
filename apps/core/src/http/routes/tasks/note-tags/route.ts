import { taskNoteTags as taskNoteTagsAction } from "../../../../../../../packages/shared/actions/tasks";
import { requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { taskNoteTags } from "../../../../domains/tasks/note-tags";


/** taskId → tags carried by its task note, for the Work tag filter. */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return taskNoteTagsAction.handler(taskNoteTagsAction.input.parse({}), {
    execute: async () => Response.json({ tags: taskNoteTags() }),
  });
}, "tasks.noteTags.get");
