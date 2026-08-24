/**
 * AI grading for daily reps — a small, cheap generation that counts how many
 * of the agent's review findings the user had already flagged. Deliberately
 * not the full PR review: it only compares two texts the dashboard already has.
 */

import { z } from "zod";
import { generateAiText } from "@/lib/ai/generate";

export const AiGradeSchema = z.object({
  caught: z.number().int().min(0).max(999),
  missed: z.number().int().min(0).max(999),
  missedSummary: z.string().max(400).optional(),
});

export type AiGrade = z.infer<typeof AiGradeSchema>;

/** Pull the JSON object out of a model reply (tolerates prose and fences). */
export function parseAiGradeText(text: string): AiGrade {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI grader returned no JSON.");
  let raw: unknown;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    throw new Error("AI grader returned invalid JSON.");
  }
  const parsed = AiGradeSchema.safeParse(raw);
  if (!parsed.success) throw new Error("AI grader returned invalid counts.");
  const grade = parsed.data;
  return grade.missedSummary?.trim() ? grade : { caught: grade.caught, missed: grade.missed };
}

const SYSTEM = "You grade code-review practice runs. Reply with only minified JSON.";

/** Compare the user's findings to the agent review; counts only, no re-review. */
export async function aiGradeFindings(findings: string, agentReview: string): Promise<AiGrade> {
  const prompt = [
    "A developer reviewed a pull request unaided, then an AI agent reviewed the same PR.",
    "Grade the developer: count the agent's distinct review findings — how many the developer had already flagged (caught) and how many they missed.",
    "The same concern raised in different words counts once as caught. Do not invent findings.",
    "",
    "Developer findings:",
    findings,
    "",
    "Agent review:",
    agentReview.slice(0, 12_000),
    "",
    'Reply with only: {"caught":<int>,"missed":<int>,"missedSummary":"<one short sentence naming what was missed, empty string if none>"}',
  ].join("\n");
  const result = await generateAiText({ prompt, system: SYSTEM, timeoutMs: 600_000 });
  return parseAiGradeText(result.text);
}
