import { describe, expect, it } from "vitest";
import {
  applyEffort,
  cliEffortArgs,
  effortOptionsForModel,
} from "./effort";

describe("effortOptionsForModel", () => {
  it("uses Paseo thinking options when the snapshot lists them", () => {
    expect(effortOptionsForModel({
      provider: "claude",
      model: "claude-opus-4",
      thinkingOptions: [{ id: "think", label: "Think" }],
    })).toEqual([{ id: "think", label: "Think" }]);
  });

  it("lists Claude, OpenAI gpt-5/6, Cursor and GLM, and hides unknown models", () => {
    expect(effortOptionsForModel({ provider: "claude", model: "" })?.map((option) => option.id)).toEqual([
      "low", "medium", "high", "xhigh", "max",
    ]);
    expect(effortOptionsForModel({ model: "gpt-6-luna" })?.map((option) => option.id)).toEqual([
      "none", "minimal", "low", "medium", "high", "xhigh",
    ]);
    expect(effortOptionsForModel({ model: "gpt-5.4-mini" })?.map((option) => option.id)).toContain("none");
    expect(effortOptionsForModel({ model: "gpt-5.4-mini" })?.map((option) => option.id)).not.toContain("max");
    expect(effortOptionsForModel({ model: "grok-4.6" })?.map((option) => option.id)).toEqual([
      "low", "medium", "high", "xhigh", "max",
    ]);
    expect(effortOptionsForModel({ provider: "api", model: "glm-5-turbo" })?.map((option) => option.id)).toEqual(["on", "off"]);
    expect(effortOptionsForModel({ provider: "opencode", model: "kimi" })).toBeNull();
    expect(effortOptionsForModel({ provider: "opencode", model: "" })).toBeNull();
  });
});

describe("applyEffort", () => {
  it("sends nothing for Default and drops an effort the model does not support", () => {
    expect(applyEffort({ provider: "claude", model: "claude-opus-4", effort: "" })).toEqual({ model: "claude-opus-4" });
    expect(applyEffort({ provider: "opencode", model: "kimi", effort: "high" })).toEqual({ model: "kimi" });
  });

  it("passes Claude and OpenAI as a thinking option, and OpenAI also as reasoning effort", () => {
    expect(applyEffort({ provider: "claude", model: "claude-opus-4", effort: "xhigh" })).toEqual({
      model: "claude-opus-4",
      thinkingOptionId: "xhigh",
    });
    expect(applyEffort({ provider: "codex", model: "gpt-6-astra", effort: "high" })).toEqual({
      model: "gpt-6-astra",
      thinkingOptionId: "high",
      reasoningEffort: "high",
    });
    expect(cliEffortArgs("claude", "high")).toEqual(["--effort", "high"]);
    expect(cliEffortArgs("codex", "high")).toEqual(["-c", "model_reasoning_effort=high"]);
    expect(cliEffortArgs("claude", "")).toEqual([]);
  });

  it("maps Cursor effort onto model variants from the live catalog", () => {
    const models = [
      "grok-4.7-low",
      "grok-4.7-medium",
      "grok-4.7-high",
      "grok-4.7-xhigh",
      "composer-2.5",
      "composer-2.5-fast",
      "gpt-5.6-sol-low",
      "gpt-5.6-sol-medium",
      "gpt-5.6-sol-high",
      "gpt-5.6-sol-xhigh",
    ];

    expect(applyEffort({
      provider: "cursor",
      model: "grok-4.7-xhigh",
      effort: "low",
      availableModels: models,
    })).toEqual({ model: "grok-4.7-low" });
    expect(applyEffort({
      provider: "cursor",
      model: "composer-2.5",
      effort: "medium",
      availableModels: models,
    })).toEqual({ model: "composer-2.5" });
    expect(applyEffort({
      provider: "cursor",
      model: "gpt-5.6-sol-high",
      effort: "xhigh",
      availableModels: models,
    })).toEqual({ model: "gpt-5.6-sol-xhigh" });
    expect(cliEffortArgs("cursor", "high")).toEqual([]);
  });

  it("only offers Cursor effort when the live catalog has variants", () => {
    const models = ["grok-4.7-low", "grok-4.7-medium", "grok-4.7-high", "grok-4.7-xhigh", "composer-2.5"];
    expect(effortOptionsForModel({
      provider: "cursor",
      model: "grok-4.7-xhigh",
    })).toBeNull();
    expect(effortOptionsForModel({
      provider: "cursor",
      model: "grok-4.7-xhigh",
      availableModels: models,
    })?.map((option) => option.id)).toEqual(["low", "medium", "high", "xhigh"]);
    expect(effortOptionsForModel({
      provider: "cursor",
      model: "composer-2.5",
      availableModels: models,
    })).toBeNull();
  });

  it("uses Cursor's live variants for Cursor-hosted GPT models", () => {
    const models = ["gpt-5.6-sol-none", "gpt-5.6-sol-low", "gpt-5.6-sol-max"];
    expect(effortOptionsForModel({
      provider: "cursor-cli",
      model: "gpt-5.6-sol-low",
      availableModels: models,
    })?.map((option) => option.id)).toEqual(["none", "low", "max"]);
  });

  it("offers and maps a single live Cursor variant", () => {
    const models = ["grok-4.7-low", "composer-2.5"];
    expect(effortOptionsForModel({
      provider: "cursor",
      model: "grok-4.7-low",
      availableModels: models,
    })?.map((option) => option.id)).toEqual(["low"]);
    expect(applyEffort({
      provider: "cursor",
      model: "grok-4.7-low",
      effort: "low",
      availableModels: models,
    })).toEqual({ model: "grok-4.7-low" });
  });

  it("migrates a legacy Cursor suffix plus effort parameter", () => {
    const models = ["grok-4.7-low", "grok-4.7-medium", "grok-4.7-high", "grok-4.7-xhigh"];
    expect(applyEffort({
      provider: "cursor-cli",
      model: "grok-4.7-xhigh[effort=low]",
      availableModels: models,
    })).toEqual({ model: "grok-4.7-low" });
  });

  it("does not apply Cursor serialization to another provider's Grok model", () => {
    expect(effortOptionsForModel({
      provider: "opencode",
      model: "grok-4.7",
      thinkingOptions: [{ id: "high", label: "High" }],
      availableModels: ["grok-4.7-low", "grok-4.7-high"],
    })).toEqual([{ id: "high", label: "High" }]);
    expect(applyEffort({
      provider: "opencode",
      model: "grok-4.7",
      effort: "high",
    })).toEqual({ model: "grok-4.7", thinkingOptionId: "high" });
  });

  it("maps GLM to the thinking switch and leaves Default unset", () => {
    expect(applyEffort({ provider: "api", model: "glm-5-turbo", effort: "on" })).toEqual({
      model: "glm-5-turbo",
      glmThinking: "enabled",
    });
    expect(applyEffort({ provider: "api", model: "glm-5-turbo", effort: "off" }).glmThinking).toBe("disabled");
    expect(applyEffort({ provider: "api", model: "glm-5-turbo" }).glmThinking).toBeUndefined();
  });
});
