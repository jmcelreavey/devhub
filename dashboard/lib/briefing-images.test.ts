import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { imageCacheKey, isImageAiConfigured, normalizeImageSize } from "./briefing-images";

const ENV_KEYS = ["AI_API_KEY", "AI_BASE_URL", "AI_IMAGE_BASE_URL", "AI_IMAGE_MODEL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("isImageAiConfigured", () => {
  it("is off without an API key", () => {
    process.env.AI_BASE_URL = "https://api.openai.com/v1";
    expect(isImageAiConfigured()).toBe(false);
  });

  it("auto-enables on the OpenAI endpoint", () => {
    process.env.AI_API_KEY = "sk-test";
    process.env.AI_BASE_URL = "https://api.openai.com/v1";
    expect(isImageAiConfigured()).toBe(true);
  });

  it("stays off for other providers unless AI_IMAGE_MODEL opts in", () => {
    process.env.AI_API_KEY = "key";
    process.env.AI_BASE_URL = "https://api.z.ai/api/coding/paas/v4";
    expect(isImageAiConfigured()).toBe(false);
    process.env.AI_IMAGE_MODEL = "cogview-4";
    expect(isImageAiConfigured()).toBe(true);
  });
});

describe("normalizeImageSize", () => {
  it("accepts known sizes and defaults the rest", () => {
    expect(normalizeImageSize("1024x1536")).toBe("1024x1536");
    expect(normalizeImageSize("999x999")).toBe("1536x1024");
    expect(normalizeImageSize(null)).toBe("1536x1024");
  });
});

describe("imageCacheKey", () => {
  it("is stable for identical inputs and distinct otherwise", () => {
    const a = imageCacheKey("gpt-image-1", "1536x1024", "anime skyline");
    expect(imageCacheKey("gpt-image-1", "1536x1024", "anime skyline")).toBe(a);
    expect(imageCacheKey("gpt-image-1", "1024x1024", "anime skyline")).not.toBe(a);
    expect(imageCacheKey("gpt-image-1", "1536x1024", "anime alley")).not.toBe(a);
  });
});
