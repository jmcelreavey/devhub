import { JEV_TEXT_MODEL } from "@devhub/qa";
import { typesafeApiKey } from "@/lib/qa/credentials";

// Repo figure for Jev input pricing (packages/qa/src/jev.ts); an estimate, not TypeSafe's live price.
const INPUT_USD_PER_MILLION = 0.042;

export interface JevOption { id: string; description: string }
export interface JevQuestion {
  /** John's message. */
  goal: string;
  /** Untrusted background (short descriptions only). */
  context: string;
  instructions: string;
  options: readonly JevOption[];
}
export interface JevChoice {
  id: string;
  confidence: number;
  probabilities: Record<string, number>;
  costUsd: number | null;
}
export type JevChooser = (question: JevQuestion) => Promise<JevChoice>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function probability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Same TypeSafe `systemone` wire contract as packages/qa jevPolicy, but it keeps the probability
 * distribution (jevPolicy drops it) so a close second place can become a "Did you mean…?" button.
 * Errors never include the response body or key.
 */
export function createJevChooser(deps: { apiKey?: () => string | undefined; fetch?: typeof fetch } = {}): JevChooser {
  return async (question) => {
    const key = (deps.apiKey ?? typesafeApiKey)();
    if (!key) throw new Error("TYPESAFE_API_KEY is not configured.");
    if (!question.options.length || question.options.length > 255) throw new Error("Jev requires 1–255 options.");
    const response = await (deps.fetch ?? fetch)("https://api.typesafe.ai/v1/systemone", {
      method: "POST", signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: JEV_TEXT_MODEL,
        state: { goal: question.goal.slice(0, 1000), observation: question.context.slice(0, 16000) },
        questions: { pick: { type: "choice", instructions: question.instructions, criteria: Object.fromEntries(question.options.map((option) => [option.id, option.description])) } },
      }),
    });
    if (!response.ok) throw new Error(`TypeSafe returned HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    const answer = record(payload) && record(payload.answers) && record(payload.answers.pick) ? payload.answers.pick : {};
    const probabilities = record(answer.probabilities) ? answer.probabilities : {};
    if (answer.type !== "choice" || typeof answer.choice !== "string" || !question.options.some((option) => option.id === answer.choice)
      || !probability(answer.confidence) || !question.options.every((option) => probability(probabilities[option.id]))) {
      throw new Error("TypeSafe returned an invalid or unoffered choice.");
    }
    const usage = record(payload) && record(payload.usage) ? payload.usage : {};
    const input = Number.isSafeInteger(usage.input_tokens) && Number(usage.input_tokens) >= 0 ? Number(usage.input_tokens) : null;
    return {
      id: answer.choice, confidence: answer.confidence, probabilities: probabilities as Record<string, number>,
      costUsd: input === null ? null : input / 1_000_000 * INPUT_USD_PER_MILLION,
    };
  };
}
