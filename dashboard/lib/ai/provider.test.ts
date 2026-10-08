import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getNotesAiModel, getNotesAiCallOptions, normalizeReasoningEffort } from "@/lib/ai/provider";

const ENV_KEYS = ["AI_API_KEY", "AI_BASE_URL", "AI_MODEL"] as const;

describe("getNotesAiModel", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
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
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
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
    process.env.AI_API_KEY = "test-key";
    process.env.AI_BASE_URL = "https://api.openai.com/v1";
    process.env.AI_MODEL = "gpt-4o-mini";
    expect(getNotesAiCallOptions()).toEqual({});
  });

  it("sends a reasoning effort only to OpenAI proper", () => {
    process.env.AI_API_KEY = "test-key";
    process.env.AI_BASE_URL = "https://api.openai.com/v1";
    process.env.AI_MODEL = "gpt-6-luna";
    expect(getNotesAiCallOptions(undefined, "low")).toEqual({ providerOptions: { openai: { reasoningEffort: "low" } } });
    expect(getNotesAiCallOptions(undefined, null)).toEqual({});

    process.env.AI_BASE_URL = "https://openrouter.ai/api/v1";
    expect(getNotesAiCallOptions(undefined, "low")).toEqual({});
  });

  it("keeps GLM's thinking switch and never adds an effort for it", () => {
    process.env.AI_API_KEY = "test-key";
    delete process.env.AI_BASE_URL;
    delete process.env.AI_MODEL;
    expect(getNotesAiCallOptions(undefined, "high")).toMatchObject({
      providerOptions: { notesai: { thinking: { type: "disabled" } } },
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
