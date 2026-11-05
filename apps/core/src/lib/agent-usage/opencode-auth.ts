import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { openReadOnlySqliteDatabase } from "../../domains/storage/sqlite";

const authSchema = z.record(z.string(), z.object({ type: z.string(), key: z.string().optional() }).passthrough());
const credentialSchema = z.object({ type: z.literal("key"), key: z.string().min(1) });

function openCodeDataDir(): string {
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "opencode");
}

/** OpenCode 2 keeps the selected login in SQLite; auth.json is only its old import source. */
export function findActiveOpenCodeKey(ids: string[]): string | null {
  const databasePath = path.resolve(openCodeDataDir(), process.env.OPENCODE_DB || "opencode.db");
  const database = openReadOnlySqliteDatabase(databasePath);
  if (!database) return null;
  try {
    const hasCredentials = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'credential'").get();
    if (!hasCredentials) return null;
    const statement = database.prepare("SELECT value FROM credential WHERE integration_id = ? ORDER BY active DESC, time_updated DESC LIMIT 1");
    for (const id of ids) {
      const row = statement.get(id) as { value?: unknown } | undefined;
      if (typeof row?.value !== "string") continue;
      const credential = credentialSchema.safeParse(JSON.parse(row.value));
      const key = credential.success ? credential.data.key.trim() : "";
      if (key) return key;
    }
  } finally {
    database.close();
  }
  return null;
}

/**
 * An API key for a provider, from its env var or OpenCode's auth.json. null means
 * the provider isn't set up here, which callers treat as "don't show it".
 */
export async function findApiKey(envVar: string, openCodeIds: string[]): Promise<string | null> {
  const fromEnv = process.env[envVar]?.trim();
  if (fromEnv) return fromEnv;
  try {
    const file = path.join(openCodeDataDir(), "auth.json");
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
