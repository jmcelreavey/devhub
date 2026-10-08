import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenAI } from "@ai-sdk/openai";
import { wrapLanguageModel, type LanguageModel } from "ai";
import { isNotesAiConfigured } from "@/lib/notes-ai/config";
import { aiActivityMiddleware, type AiActivityOptions } from "./activity";

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

function resolveProviderConfig(modelOverride?: string): ProviderConfig {
  const apiKey = process.env.AI_API_KEY!.trim();
  const baseURL = (process.env.AI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  const modelId = modelOverride?.trim() || process.env.AI_MODEL?.trim() || DEFAULT_MODEL;
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
export function getNotesAiModel(activity?: AiActivityOptions, modelOverride?: string): LanguageModel | null {
  if (!isNotesAiConfigured()) return null;
  const { apiKey, baseURL, modelId } = resolveProviderConfig(modelOverride);
  const model = isOpenAiEndpoint(baseURL)
    ? createOpenAI({ apiKey, baseURL })(modelId)
    : createOpenAICompatible({ name: PROVIDER_NAME, baseURL, apiKey })(modelId);
  return wrapLanguageModel({ model, middleware: aiActivityMiddleware(activity) });
}

/** Values OpenAI accepts for `reasoning.effort` across the gpt-5 / gpt-6 families. */
export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export function normalizeReasoningEffort(raw: string | undefined | null): ReasoningEffort | null {
  const value = raw?.trim().toLowerCase();
  return value && (REASONING_EFFORTS as readonly string[]).includes(value) ? (value as ReasoningEffort) : null;
}

/** `gpt-6-luna`, `gpt-5.6-luna`, and the same id behind a provider prefix. */
const LUNA_FAMILY_MODEL = /^gpt-.+-luna$/i;

function modelName(modelId: string): string {
  return modelId.split("/").pop()?.trim() || modelId.trim();
}

/**
 * Effort to send when nobody asked for one.
 * Luna's own default is `medium`; `low` is faster on the same drafts and the quality held up.
 * Every other model sends nothing and keeps its provider default.
 */
function defaultReasoningEffort(modelId: string): ReasoningEffort | null {
  return LUNA_FAMILY_MODEL.test(modelName(modelId)) ? "low" : null;
}

/**
 * First match wins: per-call override, then `AI_REASONING_EFFORT`, then the model default.
 * An invalid env value is ignored so the next step can apply. `null` is not an override.
 */
function resolveReasoningEffort(modelId: string, featureOverride?: ReasoningEffort | null): ReasoningEffort | null {
  if (featureOverride) return featureOverride;
  return normalizeReasoningEffort(process.env.AI_REASONING_EFFORT) ?? defaultReasoningEffort(modelId);
}

const DISABLE_THINKING = {
  providerOptions: { [PROVIDER_NAME]: { thinking: { type: "disabled" as const } } },
} as const;

/**
 * Per-call options to spread into generateText/streamText.
 * Reasoning effort is only attached for OpenAI endpoints (`api.openai.com`).
 * The `thinking` switch is a GLM/z.ai extension and replaces that field; other
 * providers reject unknown body fields, so anything else gets an empty object.
 */
export function getNotesAiCallOptions(
  modelOverride?: string,
  reasoningEffort?: ReasoningEffort | null,
): typeof DISABLE_THINKING | { providerOptions: { openai: { reasoningEffort: ReasoningEffort } } } | Record<string, never> {
  const { baseURL, modelId } = resolveProviderConfig(modelOverride);
  const isGlm = /z\.ai/i.test(baseURL) || /glm/i.test(modelId);
  if (isGlm) return DISABLE_THINKING;
  const effort = resolveReasoningEffort(modelId, reasoningEffort);
  if (effort && isOpenAiEndpoint(baseURL)) return { providerOptions: { openai: { reasoningEffort: effort } } };
  return {};
}
