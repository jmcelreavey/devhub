import { terminalProposalList, terminalProposalStatus, terminalPropose, terminalProposeBodyInput, terminalResolve } from "../../../../../../../packages/shared/actions/terminal";
import { httpAction } from "../../../../lib/actions/http";
import { parseBody, withErrorHandler } from "../../../../lib/api-utils";
import {
  createTerminalProposal,
  getTerminalProposal,
  listTerminalProposals,
  resolveTerminalProposal,
} from "../../../../lib/terminal/proposals";


/** List pending (or all) proposals for the dock / MCP status. */
export const GET = withErrorHandler(async (req: Request) => {
  const status = new URL(req.url).searchParams.get("status");
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    return httpAction(terminalProposalStatus, {
      input: () => ({ id }),
      context: () => ({ find: getTerminalProposal }),
      response: ({ proposal }) => proposal
        ? Response.json({ proposal })
        : Response.json({ error: "Not found" }, { status: 404 }),
    })(req);
  }
  return httpAction(terminalProposalList, {
    input: () => ({ status: status ?? undefined }),
    context: () => ({ list: (requested) => listTerminalProposals(
      requested === "pending" || requested === "approved" || requested === "denied" ||
      requested === "expired" || requested === "injected" || requested === "failed"
        ? { status: requested }
        : undefined,
    ) }),
    response: (result) => Response.json(result),
  })(req);
}, "terminal.propose.get");

/** MCP / API queues a run; destructive commands retain dock confirmation. */
export const POST = withErrorHandler(async (req: Request) => {
  const parsed = await parseBody(req, terminalProposeBodyInput);
  if (!parsed.ok) return parsed.response;
  return httpAction(terminalPropose, {
    input: () => parsed.data,
    context: () => ({ create: () => {
      try {
        return { status: 201, proposal: createTerminalProposal(parsed.data) };
      } catch (error) {
        return { status: 400, error: error instanceof Error ? error.message : "Could not create proposal" };
      }
    } }),
    response: (result) => "proposal" in result
      ? Response.json({ proposal: result.proposal }, { status: result.status })
      : Response.json({ error: result.error }, { status: result.status }),
  })(req);
}, "terminal.propose.post");

/** Dock resolves: approve / deny / injected. */
export const PATCH = httpAction(terminalResolve, {
  input: (req) => req.json(),
  context: () => ({ resolve: ({ id, action, finalCommand, error }) => resolveTerminalProposal(id, action, { finalCommand, error }) }),
  response: ({ proposal }) => proposal
    ? Response.json({ proposal })
    : Response.json({ error: "Not found" }, { status: 404 }),
});
