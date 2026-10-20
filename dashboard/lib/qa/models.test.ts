import { describe, expect, it } from "vitest";
import { isDecisionModel } from "./models";

describe("QA model catalogue", () => {
  it("excludes non-decision endpoints and legacy text-only models", () => {
    for (const id of ["text-embedding-3-small", "gpt-4o-transcribe", "gpt-image-2", "gpt-audio", "sora-2", "gpt-realtime", "ada:ft-team", "gpt-3.5-turbo", "gpt-4-0613", "gpt-4"]) expect(isDecisionModel(id)).toBe(false);
  });
  it("keeps modern chat, fine-tuned vision and custom provider models", () => {
    for (const id of ["gpt-4o", "gpt-4.1-mini", "gpt-6-luna", "ft:gpt-4o:team:custom", "claude-sonnet-4-5", "custom-vision"]) expect(isDecisionModel(id)).toBe(true);
  });
});
