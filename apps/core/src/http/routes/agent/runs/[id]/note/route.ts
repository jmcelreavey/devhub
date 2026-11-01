import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../../../lib/api-utils";
import { httpAction } from "../../../../../../lib/actions/http";
import { agentInteractiveNote, agentInteractiveNoteInput } from "../../../../../../../../../packages/shared/actions/agents";
import {
  appendInteractiveAgentNote,
  readAgentRun,
  toAgentRunSummary,
} from "../../../../../../lib/agent-runs/store";


interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withErrorHandler(async (req: Request, { params }: RouteContext) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const run = readAgentRun((await params).id);
  if (!run) return Response.json({ error: "run not found" }, { status: 404 });
  if (run.spec.bin !== "interactive") {
    return Response.json({ error: "only interactive runs accept notes via this route" }, { status: 400 });
  }
  const parsed = await parseBody(req, agentInteractiveNoteInput.omit({ runId: true }));
  if (!parsed.ok) return parsed.response;
  return httpAction(agentInteractiveNote, {
    input: () => ({ runId: run.spec.id, ...parsed.data }),
    context: () => ({ note: ({ text }) => ({ run: toAgentRunSummary(appendInteractiveAgentNote(run, text)) }) }),
    response: (result) => Response.json(result),
  })(req);
}, "agent.runs.note.post");
