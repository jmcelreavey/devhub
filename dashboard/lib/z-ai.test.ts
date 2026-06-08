import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getZAiNotesModel } from "./z-ai";

const ENV_KEYS = ["Z_AI_API_KEY", "Z_AI_BASE_URL", "Z_AI_MODEL"] as const;

describe("getZAiNotesModel", () => {
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

  it("returns null without Z_AI_API_KEY", () => {
    delete process.env.Z_AI_API_KEY;
    expect(getZAiNotesModel()).toBeNull();
  });

  it("returns a model when Z_AI_API_KEY is set", () => {
    process.env.Z_AI_API_KEY = "test-key";
    delete process.env.Z_AI_BASE_URL;
    delete process.env.Z_AI_MODEL;
    expect(getZAiNotesModel()).not.toBeNull();
  });
});
