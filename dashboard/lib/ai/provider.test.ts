import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getNotesAiModel, getNotesAiCallOptions, normalizeReasoningEffort } from "@/lib/ai/provider";

const ENV_KEYS = ["AI_API_KEY", "AI_BASE_URL", "AI_MODEL", "AI_REASONING_EFFORT"] as const;

function saveEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

function useOpenAi(model: string) {
  process.env.AI_API_KEY = "test-key";
  process.env.AI_BASE_URL = "https://api.openai.com/v1";
  process.env.AI_MODEL = model;
  delete process.env.AI_REASONING_EFFORT;
}

describe("getNotesAiModel", () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = saveEnv();
  });

  afterEach(() => {
    restoreEnv(saved);
  });

  it("returns null without AI_API_KEY", () => {
    delete process.env.AI_API_KEY;
    expect(getNotesAiModel()).toBeNull();
  });

  it("returns a model when AI_API_KEY is set", () => {
    process.env.AI_API_KEY = "test-key";
    delete process.env.AI_BASE_URL;
    delete process.env.AI_MODEL;
    expect(getNotesAiModel()).not.toBeNull();
  });
});

describe("getNotesAiCallOptions", () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = saveEnv();
    delete process.env.AI_REASONING_EFFORT;
  });

  afterEach(() => {
    restoreEnv(saved);
  });

  it("sends the GLM thinking option for the default z.ai endpoint", () => {
    process.env.AI_API_KEY = "test-key";
    delete process.env.AI_BASE_URL;
    delete process.env.AI_MODEL;
    expect(getNotesAiCallOptions()).toMatchObject({
      providerOptions: { notesai: { thinking: { type: "disabled" } } },
    });
  });

  it("omits the thinking option for a non-GLM provider (e.g. OpenAI)", () => {
    useOpenAi("gpt-5.4-mini");
    expect(getNotesAiCallOptions()).toEqual({});
  });

  it("sends a reasoning effort only to OpenAI proper", () => {
    useOpenAi("gpt-5.4-mini");
    expect(getNotesAiCallOptions(undefined, "low")).toEqual({ providerOptions: { openai: { reasoningEffort: "low" } } });

    process.env.AI_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.AI_MODEL = "gpt-6-luna";
    process.env.AI_REASONING_EFFORT = "high";
    expect(getNotesAiCallOptions(undefined, "low")).toEqual({});
    expect(getNotesAiCallOptions()).toEqual({});
  });

  it("keeps GLM's thinking switch and never adds an effort for it", () => {
    process.env.AI_API_KEY = "test-key";
    delete process.env.AI_BASE_URL;
    delete process.env.AI_MODEL;
    process.env.AI_REASONING_EFFORT = "high";
    expect(getNotesAiCallOptions(undefined, "high")).toMatchObject({
      providerOptions: { notesai: { thinking: { type: "disabled" } } },
    });
    expect(getNotesAiCallOptions()).not.toHaveProperty("providerOptions.openai");
  });

  it("resolves effort as feature override, then AI_REASONING_EFFORT, then Luna low, then nothing", () => {
    useOpenAi("gpt-6-luna");
    process.env.AI_REASONING_EFFORT = "high";
    expect(getNotesAiCallOptions(undefined, "medium")).toEqual({
      providerOptions: { openai: { reasoningEffort: "medium" } },
    });
    expect(getNotesAiCallOptions(undefined, null)).toEqual({
      providerOptions: { openai: { reasoningEffort: "high" } },
    });

    delete process.env.AI_REASONING_EFFORT;
    expect(getNotesAiCallOptions()).toEqual({ providerOptions: { openai: { reasoningEffort: "low" } } });

    process.env.AI_REASONING_EFFORT = "none";
    expect(getNotesAiCallOptions()).toEqual({ providerOptions: { openai: { reasoningEffort: "none" } } });

    process.env.AI_REASONING_EFFORT = "turbo";
    expect(getNotesAiCallOptions()).toEqual({ providerOptions: { openai: { reasoningEffort: "low" } } });

    useOpenAi("gpt-5.4-mini");
    expect(getNotesAiCallOptions()).toEqual({});
    process.env.AI_REASONING_EFFORT = "not-an-effort";
    expect(getNotesAiCallOptions()).toEqual({});
    process.env.AI_REASONING_EFFORT = " HIGH ";
    expect(getNotesAiCallOptions()).toEqual({ providerOptions: { openai: { reasoningEffort: "high" } } });
  });

  it("applies the Luna default to the model used for the call", () => {
    useOpenAi("gpt-5.4-mini");
    expect(getNotesAiCallOptions("gpt-6-luna")).toEqual({
      providerOptions: { openai: { reasoningEffort: "low" } },
    });
    expect(getNotesAiCallOptions("openai/gpt-5.6-luna")).toEqual({
      providerOptions: { openai: { reasoningEffort: "low" } },
    });

    useOpenAi("gpt-6-luna");
    expect(getNotesAiCallOptions("gpt-5.4-mini")).toEqual({});
    expect(getNotesAiCallOptions(undefined, "none")).toEqual({
      providerOptions: { openai: { reasoningEffort: "none" } },
    });
  });
});

describe("normalizeReasoningEffort", () => {
  it("accepts known efforts case-insensitively and rejects anything else", () => {
    expect(normalizeReasoningEffort(" Low ")).toBe("low");
    expect(normalizeReasoningEffort("none")).toBe("none");
    expect(normalizeReasoningEffort("turbo")).toBeNull();
    expect(normalizeReasoningEffort("")).toBeNull();
    expect(normalizeReasoningEffort(undefined)).toBeNull();
  });
});
