import { z } from "zod";
import { defineAction } from "./define.ts";

interface VoiceContext<Input> { execute: (input: Input) => unknown }

export const voiceListInput = z.object({
        filter: z.enum(["unanswered", "new", "answered"]).optional().describe("new = answered but not learned yet"),
        scenarioId: z.string().optional().describe("One scenario, with the full answer"),
      }).meta({ additionalProperties: false });
export const voiceList = defineAction<typeof voiceListInput, VoiceContext<z.output<typeof voiceListInput>>, unknown>({
  input: voiceListInput,
  http: {"method":"GET","path":"/api/voice"},
  mcp: { name: "voice_list", toolset: "workspace", description: "My voice: the scenarios used to train the user's my-voice skill, with their saved answers and what's still new since the last training round. Use it to see progress and to pick the next scenario to ask about. Pass scenarioId for one scenario with the user's full answer. Requires the dashboard running." },
  handler: (input, context) => context.execute(input),
});

export const voiceAnswerInput = z.object({
        scenarioId: z.string().min(1).describe("Scenario id from voice_list"),
        answer: z.string().max(4_000).describe("The user's own words, verbatim. Blank clears the answer."),
      }).meta({ additionalProperties: false });
export const voiceAnswer = defineAction<typeof voiceAnswerInput, VoiceContext<z.output<typeof voiceAnswerInput>>, unknown>({
  input: voiceAnswerInput,
  http: {"method":"PUT","path":"/api/voice"},
  mcp: { name: "voice_answer", toolset: "workspace", description: "Record the user's answer to one scenario, or clear it with a blank answer. The answer must be what the USER wrote, in their own words, exactly as they would send it. Never write, paraphrase or tidy an answer for them: an answer that isn't theirs teaches the skill the wrong voice. Ask them, then pass their text through verbatim. Saving replaces any earlier answer to that scenario. Requires the dashboard running." },
  handler: (input, context) => context.execute(input),
});

export const voiceTrainInput = z.object({
        action: z.enum(["start", "status"]).describe("start a draft, or check on it"),
      }).meta({ additionalProperties: false });
export const voiceTrain = defineAction<typeof voiceTrainInput, VoiceContext<z.output<typeof voiceTrainInput>>, unknown>({
  input: voiceTrainInput,
  http: {"reason":"MCP orchestration selects the existing draft start or status route; no combined HTTP endpoint."},
  mcp: { name: "voice_train", toolset: "workspace", description: "Draft an update to the user's my-voice skill from their new answers. action:start begins a draft in the background (a model call, a minute or two on a CLI provider) and returns at once; action:status reports idle / running / ready / failed, and when ready returns the full draft. Nothing is saved: show the draft to the user, then save it with voice_apply. A draft already running is joined, not duplicated. Requires the dashboard running and an AI provider." },
  handler: (input, context) => context.execute(input),
});

export const voiceApplyInput = z.object({
        confirm: z.boolean().optional().describe("Must be true: the user has reviewed the draft"),
        content: z.string().max(40_000).optional().describe("The user's edited draft, replacing the held one"),
      }).meta({ additionalProperties: false });
export const voiceApply = defineAction<typeof voiceApplyInput, VoiceContext<z.output<typeof voiceApplyInput>> & { refuse: () => unknown }, unknown>({
  input: voiceApplyInput,
  http: {"reason":"MCP requires explicit review confirmation and uses the held draft. The browser can supply the exact answer revisions with its reviewed draft."},
  mcp: { name: "voice_apply", toolset: "workspace", description: "Save the reviewed draft into the user's my-voice skill (learned-voice.md) and sync that skill out to their agent tools. This changes how agents write as them. Applies immediately with confirm:true; no human approval is required. Saves the draft the dashboard is holding; pass content only to save the user's edited text instead. Refused if their answers changed since the draft was made. Requires the dashboard running." },
  handler: (input, context) => input.confirm ? context.execute(input) : context.refuse(),
});

function localVoice<Schema extends z.ZodObject>(input: Schema, method: "GET" | "POST" | "DELETE", path: string, reason: string) {
  return defineAction<Schema, VoiceContext<z.output<Schema>>, unknown>({ input, http: { method, path }, mcp: { reason }, handler: (value, context) => context.execute(value) });
}
export const voiceDraftStartInput = z.object({ wait: z.boolean().optional() });
export const voiceDraftStart = localVoice(voiceDraftStartInput, "POST", "/api/voice/train", "The browser can await drafting; voice_train starts in the background and polls this route.");
export const voiceDraftStatusInput = z.object({});
export const voiceDraftStatus = localVoice(voiceDraftStatusInput, "GET", "/api/voice/train", "Draft state is read by the voice_train MCP orchestration.");
export const voiceDraftDiscardInput = z.object({});
export const voiceDraftDiscard = localVoice(voiceDraftDiscardInput, "DELETE", "/api/voice/train", "Discarding a reviewed voice draft is a local browser operation.");
export const voiceApplyDraftInput = z.object({
  content: z.string().min(1).optional(),
  answers: z.array(z.object({ scenarioId: z.string().min(1), answeredAt: z.string().min(1) })).min(1).optional(),
});
export const voiceApplyDraft = localVoice(voiceApplyDraftInput, "POST", "/api/voice/apply", "The browser submits its reviewed draft and answer revisions; voice_apply separately requires confirmation and uses the held draft.");
