import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateAiText } from "./generate";

const mocks = vi.hoisted(() => ({ streamText: vi.fn(), generateText: vi.fn(), cli: vi.fn() }));
vi.mock("ai", () => ({ streamText: mocks.streamText, generateText: mocks.generateText }));
vi.mock("@/lib/ai/cli-runner", () => ({ generateTextViaCli: mocks.cli }));
vi.mock("@/lib/ai/activity", () => ({
  startGenerationActivity: () => ({ append: vi.fn(), succeed: vi.fn(), fail: vi.fn() }),
}));
vi.mock("@/lib/ai/provider", () => ({ getNotesAiModel: () => ({}), getNotesAiCallOptions: () => ({}) }));
vi.mock("@/lib/ai/preference", () => ({
  isAiConfigured: () => true,
  resolveAiProvider: ({ prefer }: { prefer?: string } = {}) => ({ provider: prefer ?? "api" }),
}));

async function* parts(...items: unknown[]) {
  for (const item of items) yield item;
}

beforeEach(() => vi.resetAllMocks());

describe("generateAiText streaming", () => {
  it("passes API text deltas to the listener and returns the joined reply", async () => {
    mocks.streamText.mockReturnValue({
      fullStream: parts({ type: "text-delta", text: '{"a"' }, { type: "text-delta", text: ":1}" }),
      finishReason: Promise.resolve("stop"),
    });
    const seen: string[] = [];
    const result = await generateAiText({ prompt: "p", onTextDelta: (delta) => seen.push(delta) });
    expect(seen).toEqual(['{"a"', ":1}"]);
    expect(result).toEqual({ text: '{"a":1}', provider: "api", finishReason: "stop" });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("keeps the one-shot call when nobody is listening", async () => {
    mocks.generateText.mockResolvedValue({ text: " done ", finishReason: "stop" });
    await expect(generateAiText({ prompt: "p" })).resolves.toMatchObject({ text: "done" });
    expect(mocks.streamText).not.toHaveBeenCalled();
  });

  it("surfaces a stream error rather than returning a short reply", async () => {
    mocks.streamText.mockReturnValue({
      fullStream: parts({ type: "text-delta", text: "par" }, { type: "error", error: new Error("rate limited") }),
      finishReason: Promise.resolve("error"),
    });
    await expect(generateAiText({ prompt: "p", onTextDelta: () => {} })).rejects.toThrow("rate limited");
  });

  it("treats a stream that ended because of an abort as cancelled", async () => {
    const controller = new AbortController();
    mocks.streamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "par" };
        controller.abort();
        yield { type: "abort" };
      })(),
      finishReason: Promise.resolve("other"),
    });
    await expect(generateAiText({ prompt: "p", abortSignal: controller.signal, onTextDelta: () => {} })).rejects.toThrow();
  });

  it("hands the listener to the CLI runner", async () => {
    mocks.cli.mockResolvedValue({ text: "reply", provider: "cursor-cli" });
    const onTextDelta = vi.fn();
    await generateAiText({ prompt: "p", prefer: "cursor-cli", onTextDelta });
    expect(mocks.cli.mock.calls[0]![2]).toMatchObject({ onTextDelta });
  });
});
