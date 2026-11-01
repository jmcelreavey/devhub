import { editorPair, editorPairInput } from "../../../../../../../packages/shared/actions/editor";
import { isSameOriginStrict, parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { pairEditor, revokeEditor } from "../../../../lib/editor/pairing";
import { AgentDispatchError } from "../../../../lib/agent-runs/dispatch";
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return Response.json({ error: "Pair from this DevHub window." }, { status: 403 });
  const parsed = await parseBody(req, editorPairInput);
  if (!parsed.ok) return parsed.response;
  return await editorPair.handler(parsed.data, { execute: async () => {
    try {
      if (parsed.data.revoke) { revokeEditor(parsed.data.workspaceId); return Response.json({ revoked: true }); }
      return Response.json(pairEditor(parsed.data.workspaceId, new URL(req.url).origin), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof AgentDispatchError) return Response.json({ error: error.message }, { status: error.status });
      throw error;
    }
  } }) as Response;
}, "editor.pair");
