import { getResourceRoot } from "../../../../lib/desktop/runtime-paths";
import { scanLocalAgentImportCandidates } from "../../../../lib/collect/agents";
import { withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { localAgentCandidates } from "../../../../../../../packages/shared/actions/agents";


export const GET = withErrorHandler(async (req: Request) => httpAction(localAgentCandidates, {
  input: () => ({}),
  context: () => ({ execute: () => scanLocalAgentImportCandidates(getResourceRoot()) }),
  response: (candidates) => Response.json({ candidates }),
})(req), "agents.local");
