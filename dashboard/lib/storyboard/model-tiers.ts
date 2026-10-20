import fs from "node:fs";
import path from "node:path";
import { getNotesDir } from "@/lib/notes/dir";
import { DEFAULT_MODEL_TIERS, ModelTierSettingsSchema, type ModelTierSettings } from "./model-tiers-shared";

export * from "./model-tiers-shared";

function settingsFile(notesDir: string) {
  return path.join(notesDir, ".config", "storyboard-model-tiers.json");
}

/** Saved defaults; a missing or unreadable file falls back to the built-in defaults. */
export function readModelTiers(notesDir = getNotesDir()): ModelTierSettings {
  try {
    const parsed = ModelTierSettingsSchema.safeParse(JSON.parse(fs.readFileSync(settingsFile(notesDir), "utf8")));
    return parsed.success ? parsed.data : DEFAULT_MODEL_TIERS;
  } catch {
    return DEFAULT_MODEL_TIERS;
  }
}

export function writeModelTiers(settings: ModelTierSettings, notesDir = getNotesDir()): ModelTierSettings {
  const file = settingsFile(notesDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return settings;
}

