import { effortOptionsForModel } from "@/lib/ai/effort";
import type { QaSettings } from "./schema";
import { StoryboardError } from "@/lib/storyboard/errors";

/** /models also lists embeddings, speech and image generators: none can choose QA actions. */
export function isDecisionModel(id: string): boolean {
  return !/(?:embedding|transcrib|whisper|tts|moderation|realtime|gpt-live|gpt-audio|gpt-image|chatgpt-image|sora|instruct)/i.test(id)
    && !/^(?:ada|babbage|curie|davinci|gpt-3[.-]|gpt-4$|gpt-4-\d)/i.test(id);
}

let cached: { at: number; models: string[] } | undefined;
/** Query the configured API, not the CLI catalogue: CLI print mode cannot inspect images. */
export async function qaModelChoices(): Promise<string[]> {
  if (cached && Date.now() - cached.at < 300000) return cached.models;
  const configured = process.env.AI_MODEL?.trim();
  const models = new Set(configured ? [configured] : []);
  const base = process.env.AI_BASE_URL?.trim();
  const key = process.env.AI_API_KEY?.trim();
  if (base && key) {
    try {
      const response = await fetch(base.replace(/\/$/, "") + "/models", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(4000) });
      if (response.ok) {
        const payload: unknown = await response.json();
        if (payload && typeof payload === "object" && "data" in payload && Array.isArray(payload.data)) {
          for (const row of payload.data.slice(0, 1000)) {
            if (row && typeof row === "object" && "id" in row && typeof row.id === "string" && row.id.length <= 200 && isDecisionModel(row.id)) models.add(row.id);
          }
        }
      }
    } catch { /* The configured model remains selectable while discovery is unavailable. */ }
  }
  const result = [...models].sort();
  cached = { at: Date.now(), models: result };
  return result;
}
export async function validateQaSettings(settings: QaSettings): Promise<void> {
  const models = await qaModelChoices();
  if (settings.visionModel && !models.includes(settings.visionModel)) throw new StoryboardError("Select a model offered by the configured HTTP provider.", 400);
  const effort = effortOptionsForModel({ provider: "api", model: settings.visionModel || process.env.AI_MODEL });
  if (settings.visionEffort && !effort?.some(option => option.id === settings.visionEffort)) throw new StoryboardError("Select an effort supported by this model.", 400);
}
