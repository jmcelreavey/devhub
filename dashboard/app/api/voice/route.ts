import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { isAiConfigured } from "@/lib/ai/preference";
import { findScenario, VOICE_SCENARIOS } from "@/lib/voice/scenarios";
import { LEARNED_VOICE_FILE } from "@/lib/voice/skill";
import { readAnswers, saveAnswer } from "@/lib/voice/store";
import { resolveVoiceSkill, VoiceError } from "@/lib/voice/train";
import { MAX_ANSWER_CHARS, type VoiceState } from "@/lib/voice/types";
import { voiceRoute } from "./_shared";

export const dynamic = "force-dynamic";

export const GET = voiceRoute("state", async () => {
  const skill = resolveVoiceSkill();
  const learnedFile = skill ? path.join(skill.dir, LEARNED_VOICE_FILE) : null;
  const state: VoiceState = {
    scenarios: VOICE_SCENARIOS,
    answers: readAnswers(),
    skill: {
      found: skill !== null,
      readOnly: skill?.readOnly ?? false,
      learnedModified: learnedFile && fs.existsSync(learnedFile) ? fs.statSync(learnedFile).mtimeMs : null,
    },
    aiConfigured: isAiConfigured(),
  };
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
});

const saveSchema = z.object({
  scenarioId: z.string().min(1),
  answer: z.string().max(MAX_ANSWER_CHARS),
});

/** Save (or, when blank, clear) the answer to one scenario. */
export const PUT = voiceRoute("save", async (req) => {
  const parsed = await parseBody(req, saveSchema);
  if (!parsed.ok) return parsed.response;
  if (!findScenario(parsed.data.scenarioId)) throw new VoiceError("Unknown scenario.", 404);
  return NextResponse.json({ answers: saveAnswer(parsed.data.scenarioId, parsed.data.answer) });
});
