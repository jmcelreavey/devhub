/**
 * Unified oneshot text generation — routes through the shared AI provider
 * preference (CLI print mode or HTTP API via Vercel AI SDK).
 */

import { generateText } from "ai";
import { generateTextViaCli } from "@/lib/ai/cli-runner";
import { getNotesAiCallOptions, getNotesAiModel } from "@/lib/ai/provider";
import {
  isAiConfigured,
  resolveAiProvider,
  type AiProviderId,
} from "@/lib/ai/preference";

export interface GenerateAiTextOptions {
  prompt: string;
  system?: string;
  maxOutputTokens?: number;
  /** Override preference for this call only. */
  prefer?: AiProviderId | null;
  /** CLI timeout override (ignored for API). */
  timeoutMs?: number;
  /** CLI only — give up after this long with no output at all. */
  idleTimeoutMs?: number;
  /** Abort in-flight CLI generation when the HTTP client disconnects. */
  abortSignal?: AbortSignal;
  /** Preferred CLI cwd (still rejected if it's the app bundle). */
  cwd?: string | null;
  /** HTTP API only — CLI print mode cannot see images. */
  images?: { dataUrl: string }[];
}

export interface GenerateAiTextResult {
  text: string;
  provider: AiProviderId;
  finishReason?: string;
}

/**
 * Generate text via the resolved provider.
 * Throws when no provider is available or the call fails hard.
 */
export async function generateAiText(
  opts: GenerateAiTextOptions,
): Promise<GenerateAiTextResult> {
  const resolved = resolveAiProvider({ prefer: opts.prefer });
  if (!resolved.provider) {
    throw new Error(resolved.setupHint ?? "No AI provider available.");
  }

  const provider = resolved.provider;

  if (provider === "api") {
    const model = getNotesAiModel();
    if (!model) {
      throw new Error("AI_API_KEY is not set.");
    }
    const callOptions = getNotesAiCallOptions();
    const images = (opts.images ?? []).filter((img) => img.dataUrl.startsWith("data:image/"));
    const tokenOpts =
      opts.maxOutputTokens !== undefined ? { maxOutputTokens: opts.maxOutputTokens } : {};
    const result =
      images.length > 0
        ? await generateText({
            model,
            ...(opts.system ? { system: opts.system } : {}),
            messages: [
              {
                role: "user" as const,
                content: [
                  { type: "text" as const, text: opts.prompt },
                  ...images.map((img) => ({ type: "image" as const, image: img.dataUrl })),
                ],
              },
            ],
            ...tokenOpts,
            ...callOptions,
          })
        : opts.system
          ? await generateText({
              model,
              system: opts.system,
              prompt: opts.prompt,
              ...tokenOpts,
              ...callOptions,
            })
          : await generateText({
              model,
              prompt: opts.prompt,
              ...tokenOpts,
              ...callOptions,
            });
    return {
      text: result.text.trim(),
      provider,
      finishReason: result.finishReason,
    };
  }

  const fullPrompt = opts.system
    ? `${opts.system}\n\n${opts.prompt}`
    : opts.prompt;
  // CLI providers approximate maxOutputTokens via prompt budget (see applyCliTokenBudget).
  const cli = await generateTextViaCli(provider, fullPrompt, {
    timeoutMs: opts.timeoutMs,
    idleTimeoutMs: opts.idleTimeoutMs,
    maxOutputTokens: opts.maxOutputTokens,
    cwd: opts.cwd,
    abortSignal: opts.abortSignal,
  });
  return { text: cli.text, provider };
}

/** Compact a generation failure for UI — keep the real reason, drop the wall of CLI noise. */
export function formatGenerateError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, " ").trim().slice(0, 500) || "Generation failed.";
}

/** Soft wrapper — returns null when unconfigured or on failure. */
export async function tryGenerateAiText(
  opts: GenerateAiTextOptions,
): Promise<GenerateAiTextResult | null> {
  if (!isAiConfigured()) return null;
  try {
    const result = await generateAiText(opts);
    if (!result.text) return null;
    return result;
  } catch {
    return null;
  }
}
