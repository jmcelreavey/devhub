import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { isNotesAiConfigured } from "@/lib/notes-ai/config";

const DEFAULT_CODING_BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const DEFAULT_MODEL = "glm-5-turbo";

/** OpenAI-compatible z.ai Coding Plan model for server routes. Returns null when unset. */
export function getZAiNotesModel(): LanguageModel | null {
  if (!isNotesAiConfigured()) return null;
  const apiKey = process.env.Z_AI_API_KEY!.trim();

  const baseURL = (process.env.Z_AI_BASE_URL?.trim() || DEFAULT_CODING_BASE_URL).replace(/\/$/, "");
  const modelId = process.env.Z_AI_MODEL?.trim() || DEFAULT_MODEL;

  // Name must stay dot-free: @ai-sdk/openai-compatible derives the providerOptions
  // key via `name.split(".")[0]`, so "z.ai" would collapse to "z" and silently drop
  // per-call options like `thinking`. Callers pass providerOptions under the `zai` key.
  return createOpenAICompatible({ name: "zai", baseURL, apiKey })(modelId);
}
