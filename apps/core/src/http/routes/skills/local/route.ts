import { skillLocalCandidates } from "../../../../../../../packages/shared/actions/workspace";
import { getCheckoutRoot, getResourceRoot } from "../../../../lib/desktop/runtime-paths";
import { scanLocalSkillImportCandidates } from "../../../../lib/collect/skills";
import { withErrorHandler } from "../../../../lib/api-utils";


/** Skills found under ~/.claude/skills, ~/.codex/skills, etc. (for selective import UI). */
export const GET = withErrorHandler(async () => {
  return await skillLocalCandidates.handler({}, { execute: async () => {
    // Blocking decisions (vendored / externally owned) and drift status must
    // match the catalog the importer actually writes to — the linked checkout,
    // not the packaged resource snapshot.
    const root = getCheckoutRoot() ?? getResourceRoot();
    const candidates = scanLocalSkillImportCandidates(root);
    return Response.json({ candidates });
  } }) as Response;
}, "skills.local");
