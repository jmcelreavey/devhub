import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../opencode/shared/opencode.json");

interface OpenAiModel {
  name?: string;
  limit?: { context: number; output: number };
  cost?: { input: number; output: number; cache_read: number; cache_write: number };
  variants?: Record<string, { reasoningEffort: string }>;
}

describe("opencode shared OpenAI models", () => {
  it("parses and keeps gpt-6-luna and gpt-5.4-mini selectable", () => {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      provider: { "openai-api": { npm: string; models: Record<string, OpenAiModel> }; google: unknown };
    };
    const openai = config.provider["openai-api"];
    expect(openai.npm).toBe("@ai-sdk/openai");
    expect(config.provider.google).toBeTruthy();

    const models = openai.models;
    expect(models["gpt-5.4-mini"]).toBeDefined();
    expect(models["gpt-6-luna"]).toEqual({
      name: "GPT-6 Luna",
      limit: { context: 1_050_000, output: 128_000 },
      cost: { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125 },
      variants: {
        none: { reasoningEffort: "none" },
        low: { reasoningEffort: "low" },
        high: { reasoningEffort: "high" },
        xhigh: { reasoningEffort: "xhigh" },
        max: { reasoningEffort: "max" },
      },
    });
    expect(models["gpt-5.6-luna"]?.cost).toEqual({
      input: 0.2,
      output: 1.2,
      cache_read: 0.02,
      cache_write: 0.25,
    });
  });
});
