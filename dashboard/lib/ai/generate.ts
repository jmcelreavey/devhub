/**
 * Unified oneshot text generation — routes through the shared AI provider
 * preference (CLI print mode or HTTP API via Vercel AI SDK).
 */

import { generateText, streamText } from "ai";
import { generateTextViaCli } from "@/lib/ai/cli-runner";
import { getNotesAiCallOptions, getNotesAiModel, type ReasoningEffort } from "@/lib/ai/provider";
import { startGenerationActivity, type AiActivityOptions } from "@/lib/ai/activity";
import {
  isAiConfigured,
  resolveAiProvider,
  type AiProviderId,
} from "@/lib/ai/preference";

export interface GenerateAiTextOptions {
  activity?: AiActivityOptions;
  prompt: string;
  system?: string;
  maxOutputTokens?: number;
  /** Override preference for this call only. */
  prefer?: AiProviderId | null;
  /** Model for this call only; blank keeps the provider's configured default. */
  model?: string;
  /**
   * HTTP API on OpenAI only: `reasoning.effort` for this call.
   * Wins over `AI_REASONING_EFFORT`. Blank falls through to that env, then `low` for `gpt-*-luna`.
   */
  reasoningEffort?: ReasoningEffort | null;
  /** CLI timeout override (ignored for API). */
  timeoutMs?: number;
  /** CLI only — give up after this long with no output at all. */
  idleTimeoutMs?: number;
  /** Abort in-flight API or CLI generation when the caller disconnects. */
  abortSignal?: AbortSignal;
  /** Preferred CLI cwd (still rejected if it's the app bundle). */
  cwd?: string | null;
  /** HTTP API only — CLI print mode cannot see images. */
  images?: { dataUrl: string }[];
  /**
   * Called with each piece of the reply as it is generated. The HTTP API and
   * Cursor CLI stream; other CLIs only return the finished reply, so this is
   * never called for them. Image requests don't stream either.
   */
  onTextDelta?: (delta: string) => void;
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
    const model = getNotesAiModel({ ...opts.activity, cwd: opts.cwd ?? opts.activity?.cwd }, opts.model);
    if (!model) {
      throw new Error("AI_API_KEY is not set.");
    }
    const callOptions = { ...getNotesAiCallOptions(opts.model, opts.reasoningEffort), abortSignal: opts.abortSignal };
    const images = (opts.images ?? []).filter((img) => img.dataUrl.startsWith("data:image/"));
    const tokenOpts =
      opts.maxOutputTokens !== undefined ? { maxOutputTokens: opts.maxOutputTokens } : {};
    if (opts.onTextDelta && images.length === 0) {
      const stream = streamText({
        model,
        ...(opts.system ? { system: opts.system } : {}),
        prompt: opts.prompt,
        ...tokenOpts,
        ...callOptions,
        // Errors are rethrown from fullStream below; without a handler the SDK also logs them.
        onError: () => {},
      });
      let text = "";
      for await (const part of stream.fullStream) {
        if (part.type === "text-delta") {
          text += part.text;
          opts.onTextDelta(part.text);
        } else if (part.type === "error") {
          throw part.error instanceof Error ? part.error : new Error(String(part.error));
        }
      }
      // An aborted stream just ends, so a cancelled run must not look like a short reply.
      opts.abortSignal?.throwIfAborted();
      return { text: text.trim(), provider, finishReason: await stream.finishReason };
    }
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
  const activity = startGenerationActivity({
    provider,
    prompt: fullPrompt,
    context: { ...opts.activity, cwd: opts.cwd ?? opts.activity?.cwd },
    signal: opts.abortSignal,
  });
  try {
    const cli = await generateTextViaCli(provider, fullPrompt, {
      timeoutMs: opts.timeoutMs,
      idleTimeoutMs: opts.idleTimeoutMs,
      maxOutputTokens: opts.maxOutputTokens,
      model: opts.model,
      cwd: opts.cwd,
      abortSignal: opts.abortSignal,
      onTextDelta: opts.onTextDelta,
    });
    activity.append(cli.text);
    activity.succeed();
    return { text: cli.text, provider };
  } catch (err) {
    activity.fail(err);
    throw err;
  }
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
