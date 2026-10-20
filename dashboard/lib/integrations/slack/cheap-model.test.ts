import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateAiText } from "@/lib/ai/generate";
import { readModelTiers } from "@/lib/storyboard/model-tiers";
import { configuredAnswerTiers, runCheapModel, runTierModel } from "./cheap-model";

vi.mock("@/lib/ai/generate", () => ({ generateAiText: vi.fn() }));
vi.mock("@/lib/storyboard/model-tiers", () => ({ readModelTiers: vi.fn() }));

const tiers = (cheap: { provider: string; model: string }) => ({ tiers: { cheap, mid: { provider: "", model: "" }, heavy: { provider: "claude", model: "opus" } } }) as ReturnType<typeof readModelTiers>;
beforeEach(() => vi.clearAllMocks());

describe("runCheapModel", () => {
  it("offers only complete supported tiers and runs the chosen tier's effort without fallback", async () => {
    const settings = tiers({ provider: "codex", model: "mini" });
    settings.tiers.mid = { provider: "codex", model: "" };
    settings.tiers.heavy = { provider: "codex", model: "large", effort: "high" };
    vi.mocked(readModelTiers).mockReturnValue(settings);
    expect(configuredAnswerTiers()).toEqual(["cheap", "heavy"]);
    vi.mocked(generateAiText).mockResolvedValue({ text: "Analysis", provider: "chatgpt-cli" });
    await runTierModel("heavy", { system: "s", prompt: "p" });
    expect(generateAiText).toHaveBeenCalledWith(expect.objectContaining({ model: "large", prefer: "chatgpt-cli", effort: "high", fallback: false, timeoutMs: 180000 }));
    expect(await runTierModel("mid", { system: "s", prompt: "p" })).toEqual({ ok: false, reason: "no-cheap-tier" });
    expect(generateAiText).toHaveBeenCalledOnce();
  });
  it("combines caller cancellation with a deadline for larger answers", async () => {
    vi.mocked(readModelTiers).mockReturnValue(tiers({ provider: "codex", model: "mini" }));
    const cancel = new AbortController();
    vi.mocked(generateAiText).mockImplementation(async (options) => {
      cancel.abort();
      expect(options.abortSignal?.aborted).toBe(true);
      throw new Error("aborted");
    });
    expect(await runTierModel("cheap", { system: "s", prompt: "p", signal: cancel.signal })).toEqual({ ok: false, reason: "failed" });
  });
  it("does nothing when no cheap tier is set, even if another tier is", async () => {
    vi.mocked(readModelTiers).mockReturnValue(tiers({ provider: "", model: "" }));
    expect(await runCheapModel({ system: "s", prompt: "p" })).toEqual({ ok: false, reason: "no-cheap-tier" });
    expect(generateAiText).not.toHaveBeenCalled();
  });
  it.each([["codex", ""], ["", "mini"]])("needs both a provider and a model: provider %j + model %j makes no call", async (provider, model) => {
    vi.mocked(readModelTiers).mockReturnValue(tiers({ provider, model }));
    expect(await runCheapModel({ system: "s", prompt: "p" })).toEqual({ ok: false, reason: "no-cheap-tier" });
    expect(generateAiText).not.toHaveBeenCalled();
  });
  it("asks for that provider only: nothing else is substituted when it isn't ready", async () => {
    vi.mocked(readModelTiers).mockReturnValue(tiers({ provider: "codex", model: "mini" }));
    vi.mocked(generateAiText).mockRejectedValue(new Error("no provider"));
    expect(await runCheapModel({ system: "s", prompt: "p" })).toEqual({ ok: false, reason: "failed" });
    expect(generateAiText).toHaveBeenCalledWith(expect.objectContaining({ prefer: "chatgpt-cli", fallback: false, model: "mini" }));
  });
  it("runs the cheap tier's own provider and model with a timeout and token cap", async () => {
    vi.mocked(readModelTiers).mockReturnValue(tiers({ provider: "codex", model: "mini" }));
    vi.mocked(generateAiText).mockResolvedValue({ text: "hi", provider: "chatgpt-cli" });
    expect(await runCheapModel({ system: "s", prompt: "p", maxOutputTokens: 200 })).toEqual({ ok: true, text: "hi", label: "codex · mini" });
    expect(generateAiText).toHaveBeenCalledWith(expect.objectContaining({ prefer: "chatgpt-cli", fallback: false, model: "mini", maxOutputTokens: 200, timeoutMs: 45000 }));
  });
  it("treats a tier provider it can't run as no cheap tier, never as the default agent", async () => {
    vi.mocked(readModelTiers).mockReturnValue(tiers({ provider: "claude", model: "haiku" }));
    expect(await runCheapModel({ system: "s", prompt: "p" })).toEqual({ ok: false, reason: "no-cheap-tier" });
    expect(generateAiText).not.toHaveBeenCalled();
  });
  it("reports failure without leaking the error", async () => {
    vi.mocked(readModelTiers).mockReturnValue(tiers({ provider: "codex", model: "mini" }));
    vi.mocked(generateAiText).mockRejectedValue(new Error("secret"));
    expect(await runCheapModel({ system: "s", prompt: "p" })).toEqual({ ok: false, reason: "failed" });
  });
  it("caps the reply length", async () => {
    vi.mocked(readModelTiers).mockReturnValue(tiers({ provider: "codex", model: "mini" }));
    vi.mocked(generateAiText).mockResolvedValue({ text: "z".repeat(20000), provider: "api" });
    const result = await runCheapModel({ system: "s", prompt: "p" });
    expect(result.ok && result.text.length).toBe(6000);
  });
});
