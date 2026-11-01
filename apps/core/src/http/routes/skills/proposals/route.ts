import { skillProposalRead, skillProposalDecide, skillProposalDecideInput } from "../../../../../../../packages/shared/actions/workspace";
import { skillsProposals, skillsProposeUpdate } from "../../../../../../../packages/shared/actions/workspace";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { createSkillProposal, decideSkillProposal, listSkillProposals, readSkillProposal, SkillProposalError, proposalInput } from "../../../../lib/skills/proposals";
function failure(error: unknown) {
  if (error instanceof SkillProposalError) return Response.json({ error: error.message }, { status: error.status });
  throw error;
}
export const GET = withErrorHandler(async (request: Request) => {
  const auth = requireDashboardAuth(request); if (!auth.ok) return auth.response;
  try {
    const id = new URL(request.url).searchParams.get("id");
    return Response.json(id ? await skillProposalRead.handler({ id }, { execute: ({ id }) => readSkillProposal(id) }) : await skillsProposals.handler({}, { execute: () => ({ proposals: listSkillProposals() }) }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}, "skills.proposals.list");
export const POST = withErrorHandler(async (request: Request) => {
  const auth = requireDashboardAuth(request); if (!auth.ok) return auth.response;
  const input = await parseBody(request, proposalInput); if (!input.ok) return input.response;
  try { return Response.json(await skillsProposeUpdate.handler(input.data, { execute: createSkillProposal }), { status: 201 }); } catch (error) { return failure(error); }
}, "skills.proposals.create");
export const PATCH = withErrorHandler(async (request: Request) => {
  const auth = requireDashboardAuth(request); if (!auth.ok) return auth.response;
  const input = await parseBody(request, skillProposalDecideInput);
  if (!input.ok) return input.response;
  try { return Response.json(await skillProposalDecide.handler(input.data, { execute: ({ id, decision, baseRevision }) => decideSkillProposal(id, decision, baseRevision) })); } catch (error) { return failure(error); }
}, "skills.proposals.decide");
