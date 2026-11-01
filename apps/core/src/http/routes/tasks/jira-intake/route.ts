import { taskJiraIntakeCapture, taskJiraIntakeList } from "../../../../../../../packages/shared/actions/tasks";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { ensureTasksMigrated } from "../../../../domains/tasks/storage";
import { captureJiraTask, jiraIntakeProfile, jiraLinkedTasks } from "../../../../domains/tasks/jira-intake";


export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return taskJiraIntakeList.handler(taskJiraIntakeList.input.parse({}), { execute: async () => {
    await ensureTasksMigrated();
    return Response.json({ profile: jiraIntakeProfile(), linked: jiraLinkedTasks() });
  } });
}, "tasks.jiraIntake.get");

export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, taskJiraIntakeCapture.input);
  if (!parsed.ok) return parsed.response;
  return taskJiraIntakeCapture.handler(parsed.data, { execute: async (input) => {
    await ensureTasksMigrated();
    const result = await captureJiraTask(input);
    if ("profileChanged" in result) return Response.json({ error: "The active profile changed. Refresh before adding this ticket." }, { status: 409 });
    return Response.json(result, { status: result.created ? 201 : 200 });
  } });
}, "tasks.jiraIntake.post");
