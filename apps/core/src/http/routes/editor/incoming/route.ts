import { editorIncomingRead, editorIncomingReceive, editorIncomingDiscard, editorIncomingDiscardInput } from "../../../../../../../packages/shared/actions/editor";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { discardSelection, nextSelection, pendingSelection, receiveSelection } from "../../../../lib/editor/pairing";
import { SelectionSchema } from "../../../../lib/editor/selection";
import { AgentDispatchError } from "../../../../lib/agent-runs/dispatch";
export const POST = withErrorHandler(async (req: Request) => {
  // This external client gets only a workspace pairing token, never dashboard authority.
  if (req.headers.has("origin")) return Response.json({ error: "Use the paired editor extension." }, { status: 403 });
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || token.length > 100) return Response.json({ error: "Pair this workspace first." }, { status: 401 });
  const parsed = await parseBody(req, SelectionSchema);
  if (!parsed.ok) return parsed.response;
  try { return Response.json({ id: await editorIncomingReceive.handler(parsed.data, { execute: (input) => receiveSelection(token, input) }) }); }
  catch (error) {
    if (error instanceof AgentDispatchError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, "editor.incoming");
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return await editorIncomingRead.handler({ workspace: new URL(req.url).searchParams.get("workspace") ?? undefined, id: new URL(req.url).searchParams.get("id") ?? undefined }, { execute: async () => {
    const workspace = new URL(req.url).searchParams.get("workspace");
    if (workspace) return Response.json({ pending: nextSelection(workspace) }, { headers: { "Cache-Control": "no-store" } });
    const selection = pendingSelection(new URL(req.url).searchParams.get("id") || "");
    return selection ? Response.json({ selection }, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "This selection expired. Send it again from your editor." }, { status: 404 });
  } }) as Response;
}, "editor.incoming.get");
export const DELETE = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, editorIncomingDiscardInput);
  if (!parsed.ok) return parsed.response;
  await editorIncomingDiscard.handler(parsed.data, { execute: ({ id }) => discardSelection(id) });
  return Response.json({ removed: true });
}, "editor.incoming.delete");
