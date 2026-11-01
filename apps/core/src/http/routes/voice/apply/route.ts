import { voiceApplyDraftInput, voiceApplyDraft } from "../../../../../../../packages/shared/actions/voice";
import { parseBody } from "../../../../lib/api-utils";
import { clearDraft, getDraft } from "../../../../lib/voice/drafts";
import { applyLearnedVoice, syncVoiceSkill, VoiceError } from "../../../../lib/voice/train";
import type { VoiceApplyResult } from "../../../../../../../packages/shared/ui-lib/voice/types";
import { voiceRoute } from "../_shared";


/** Both are optional: whatever is missing comes from the draft the dashboard is holding. */
const applySchema = voiceApplyDraftInput;

/**
 * Save a reviewed draft into the skill, then push the skill out to the agent tools.
 *
 * The page sends the draft and the answers it was built from. A caller without
 * them (an agent that was shown the draft over MCP) sends nothing, or just edited
 * `content`, and the held draft supplies the rest.
 */
export const POST = voiceRoute("apply", async (req) => {
  const parsed = await parseBody(req, applySchema);
  if (!parsed.ok) return parsed.response;

  return await voiceApplyDraft.handler(parsed.data, { execute: async () => {
    const held = getDraft();
    const heldDraft = held.status === "ready" ? held.proposal : null;
    const content = parsed.data.content ?? heldDraft?.content;
    const answers = parsed.data.answers ?? heldDraft?.answers;
    if (!content || !answers) throw new VoiceError("There's no draft to apply. Draft one first.", 409);

    applyLearnedVoice(content, answers);
    clearDraft();
    const result: VoiceApplyResult = { ok: true, ...(await syncVoiceSkill()) };
    return Response.json(result);
  } }) as Response;
});
