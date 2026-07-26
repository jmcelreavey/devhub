import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { isNotesAiConfigured } from "@/lib/notes-ai/config";

// Defaults target z.ai's Coding Plan, but any OpenAI-compatible endpoint works:
// point AI_BASE_URL / AI_MODEL at OpenAI, OpenRouter, Together, a local Ollama /
// LM Studio server, etc. and set AI_API_KEY accordingly.
const DEFAULT_BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const DEFAULT_MODEL = "glm-5-turbo";

// Internal provider id for @ai-sdk/openai-compatible. Must stay dot-free: the SDK
// derives the providerOptions key via `name.split(".")[0]`, so a dotted name would
// silently drop per-call options. The providerOptions key below must match it.
const PROVIDER_NAME = "notesai";

interface ProviderConfig {
  apiKey: string;
  baseURL: string;
  modelId: string;
}

function resolveProviderConfig(): ProviderConfig {
  const apiKey = process.env.AI_API_KEY!.trim();
  const baseURL = (process.env.AI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  const modelId = process.env.AI_MODEL?.trim() || DEFAULT_MODEL;
  return { apiKey, baseURL, modelId };
}

/** True when the endpoint is OpenAI proper (needs the official provider). */
function isOpenAiEndpoint(baseURL: string): boolean {
  return /api\.openai\.com/i.test(baseURL);
}

/**
 * Chat model for the notes/briefing/repo-learn/capability routes. Returns null
 * when unset. OpenAI proper uses the official provider (it emits
 * `max_completion_tokens` for the gpt-5 / reasoning family, which the generic
 * openai-compatible provider doesn't); everything else (GLM/z.ai, OpenRouter,
 * Together, local Ollama/LM Studio, …) uses the openai-compatible provider.
 */
export function getNotesAiModel(): LanguageModel | null {
  if (!isNotesAiConfigured()) return null;
  const { apiKey, baseURL, modelId } = resolveProviderConfig();
  if (isOpenAiEndpoint(baseURL)) {
    return createOpenAI({ apiKey, baseURL })(modelId);
  }
  return createOpenAICompatible({ name: PROVIDER_NAME, baseURL, apiKey })(modelId);
}

const DISABLE_THINKING = {
  providerOptions: { [PROVIDER_NAME]: { thinking: { type: "disabled" as const } } },
} as const;

/**
 * Per-call options to spread into generateText/streamText. The `thinking` switch
 * is a GLM/z.ai extension; other OpenAI-compatible providers (OpenAI, OpenRouter,
 * …) reject unknown body fields, so it's only emitted when pointed at a GLM model
 * on z.ai. For any other provider this returns an empty object.
 */
export function getNotesAiCallOptions(): typeof DISABLE_THINKING | Record<string, never> {
  const { baseURL, modelId } = resolveProviderConfig();
  const isGlm = /z\.ai/i.test(baseURL) || /glm/i.test(modelId);
  return isGlm ? DISABLE_THINKING : {};
}
