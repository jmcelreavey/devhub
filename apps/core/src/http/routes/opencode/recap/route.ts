import { sessionRecap } from "../../../../../../../packages/shared/actions/sessions";
import { httpAction } from "../../../../lib/actions/http";
import { requireDashboardAuth } from "../../../../lib/api-utils";
import { getOpenCodeRecap, OpenCodeRecapError } from "../../../../lib/opencode/recap";


export async function GET(request: Request): Promise<Response> {
  const auth = requireDashboardAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  return httpAction(sessionRecap, {
    input: () => ({
        sessionId: url.searchParams.get("sessionId")?.trim() || undefined,
        includeChildren: url.searchParams.get("children") === "true",
        directory: url.searchParams.get("directory")?.trim() || undefined,
    }),
    context: () => ({ recap: async (input) => {
      try {
        return { status: 200, body: await getOpenCodeRecap(input) };
      } catch (error) {
        if (error instanceof OpenCodeRecapError) return { status: error.status, body: { error: error.message } };
        return { status: 503, body: { error: "OpenCode is unavailable." } };
      }
    } }),
    response: ({ status, body }) => Response.json(body, { status }),
  })(request);
}
