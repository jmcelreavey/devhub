import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isNotesAiConfigured } from "./config";

describe("isNotesAiConfigured", () => {
  const saved = process.env.Z_AI_API_KEY;

  beforeEach(() => {
    delete process.env.Z_AI_API_KEY;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.Z_AI_API_KEY;
    else process.env.Z_AI_API_KEY = saved;
  });

  it("is false without Z_AI_API_KEY", () => {
    expect(isNotesAiConfigured()).toBe(false);
  });

  it("is true when Z_AI_API_KEY is set", () => {
    process.env.Z_AI_API_KEY = "test-key";
    expect(isNotesAiConfigured()).toBe(true);
  });
});
