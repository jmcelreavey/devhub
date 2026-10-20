import { generateAiText } from "@/lib/ai/generate";
import { normalizeAiProvider } from "@/lib/ai/preference";
import { readModelTiers, type ModelTier } from "@/lib/storyboard/model-tiers";

export type CheapModelResult =
  | { ok: true; text: string; label: string }
  | { ok: false; reason: "no-cheap-tier" | "failed" };

export interface CheapModelRequest { system: string; prompt: string; maxOutputTokens?: number; signal?: AbortSignal }
export type CheapModel = (request: CheapModelRequest) => Promise<CheapModelResult>;
export type TierModel = (tier: ModelTier, request: CheapModelRequest) => Promise<CheapModelResult>;

/** Blank or unsupported tiers are never offered, and never resolve to an agent default. */
export function configuredAnswerTiers(): ModelTier[] {
  const { tiers } = readModelTiers();
  return (["cheap", "mid", "heavy"] as const).filter((tier) => {
    const { provider, model } = tiers[tier];
    return !!provider && !!model && !!normalizeAiProvider(provider);
  });
}

/** One-shot text only, pinned to the selected tier. No provider or model fallback. */
export const runTierModel: TierModel = async (tier, { system, prompt, maxOutputTokens = 700, signal }) => {
  const { provider, model, effort } = readModelTiers().tiers[tier];
  const prefer = provider && model ? normalizeAiProvider(provider) : null;
  if (!prefer) return { ok: false, reason: "no-cheap-tier" };
  const timeout = tier === "cheap" ? 45_000 : 180_000;
  try {
    const result = await generateAiText({
      system, prompt, maxOutputTokens, timeoutMs: timeout, idleTimeoutMs: timeout,
      abortSignal: AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]),
      prefer, fallback: false, model, ...(effort ? { effort } : {}),
    });
    return { ok: true, text: result.text.slice(0, 6000), label: `${provider} · ${model}` };
  } catch (error) {
    // Callers fall back to a canned reply, so this is the only trace of why the answer model failed.
    console.warn(`[slack] ${tier} answer model (${provider} · ${model}) failed: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, reason: "failed" };
  }
};

export const runCheapModel: CheapModel = (request) => runTierModel("cheap", request);
