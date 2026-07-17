/**
 * AI image generation for the briefing canvas (backgrounds, card art).
 *
 * Uses the OpenAI Images API with the same AI_API_KEY as text generation.
 * Enabled automatically when AI_BASE_URL points at api.openai.com; any other
 * OpenAI-compatible image endpoint can opt in via AI_IMAGE_BASE_URL /
 * AI_IMAGE_MODEL. Results are cached on disk keyed by (model, size, prompt),
 * so each unique prompt is billed once and refreshes are free.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export const MAX_IMAGE_PROMPT_CHARS = 600;

interface ImageProviderConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

function imageProviderConfig(): ImageProviderConfig | null {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) return null;
  const baseURL = (
    process.env.AI_IMAGE_BASE_URL?.trim() ||
    process.env.AI_BASE_URL?.trim() ||
    ""
  ).replace(/\/$/, "");
  const model =
    process.env.AI_IMAGE_MODEL?.trim() ||
    (/api\.openai\.com/i.test(baseURL) ? "gpt-image-1" : "");
  if (!baseURL || !model) return null;
  return { apiKey, baseURL, model };
}

/** True when generated imagery is available to the canvas. */
export function isImageAiConfigured(): boolean {
  return imageProviderConfig() !== null;
}

export function normalizeImageSize(raw: string | null): ImageSize {
  return (IMAGE_SIZES as readonly string[]).includes(raw ?? "")
    ? (raw as ImageSize)
    : "1536x1024";
}

/** Stable cache filename for a (model, size, prompt) triple. */
export function imageCacheKey(model: string, size: string, prompt: string): string {
  return crypto.createHash("sha256").update(`${model}\n${size}\n${prompt}`).digest("hex");
}

function cacheDir(): string {
  return path.join(os.homedir(), ".cache", "devhub", "briefing-images");
}

/** One generation per cache key at a time — refreshes reuse the same promise. */
const inFlight = new Map<string, Promise<Buffer | null>>();

async function callImagesApi(
  cfg: ImageProviderConfig,
  prompt: string,
  size: ImageSize,
): Promise<Buffer | null> {
  const res = await fetch(`${cfg.baseURL}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model: cfg.model, prompt, size, n: 1 }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as {
    data?: { b64_json?: string }[];
  } | null;
  const b64 = json?.data?.[0]?.b64_json;
  return b64 ? Buffer.from(b64, "base64") : null;
}

/**
 * Generate (or read from cache) a PNG for the prompt. Returns null when image
 * AI is unconfigured, the prompt is empty/oversized, or generation failed —
 * callers turn that into a 404 so canvas <img> fallbacks kick in.
 */
export async function getBriefingImage(
  promptRaw: string,
  size: ImageSize,
): Promise<Buffer | null> {
  const cfg = imageProviderConfig();
  const prompt = promptRaw.trim().slice(0, MAX_IMAGE_PROMPT_CHARS);
  if (!cfg || !prompt) return null;

  const key = imageCacheKey(cfg.model, size, prompt);
  const file = path.join(cacheDir(), `${key}.png`);
  try {
    return await fs.promises.readFile(file);
  } catch {
    // cache miss — generate below
  }

  const existing = inFlight.get(key);
  if (existing) return existing;

  const task = (async () => {
    try {
      const image = await callImagesApi(cfg, prompt, size);
      if (!image) return null;
      await fs.promises.mkdir(cacheDir(), { recursive: true });
      await fs.promises.writeFile(file, image);
      return image;
    } catch {
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
  return task;
}
