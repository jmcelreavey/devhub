import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const authSchema = z.record(z.string(), z.object({ type: z.string(), key: z.string().optional() }).passthrough());

/**
 * An API key for a provider, from its env var or OpenCode's auth.json. null means
 * the provider isn't set up here, which callers treat as "don't show it".
 */
export async function findApiKey(envVar: string, openCodeIds: string[]): Promise<string | null> {
  const fromEnv = process.env[envVar]?.trim();
  if (fromEnv) return fromEnv;
  try {
    const file = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "opencode", "auth.json");
    const auth = authSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
    for (const id of openCodeIds) {
      const entry = auth[id];
      if (entry?.type === "api" && entry.key) return entry.key;
    }
  } catch {
    // No OpenCode, or an auth file we can't read: same as not configured.
  }
  return null;
}
