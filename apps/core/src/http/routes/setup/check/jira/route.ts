import { setupJiraFormCheck, setupJiraSavedCheck } from "../../../../../../../../packages/shared/actions/setup";
import { parseBody } from "../../../../../lib/api-utils";
import { checkJiraConnection } from "../../../../../lib/jira/check";
import { JiraCheckSchema } from "../../../../../lib/schemas";



/** Validate the saved env config (no form values). */
export async function GET() {
  return await setupJiraSavedCheck.handler({}, {
    execute: async () => Response.json(await checkJiraConnection({})),
  }) as Response;
}

/**
 * Validate the credentials currently entered in the setup form, before they're
 * saved. Masked/untouched secrets are omitted and fall back to the saved env.
 */
export async function POST(req: Request) {
  const parsed = await parseBody(req, JiraCheckSchema);
  if (!parsed.ok) return parsed.response;

  return await setupJiraFormCheck.handler({ body: parsed.data }, {
    execute: async ({ body }) => {
      const input = body as typeof parsed.data;
      return Response.json(await checkJiraConnection(input));
    },
  }) as Response;
}
