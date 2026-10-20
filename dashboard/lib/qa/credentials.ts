import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { getRepoRoot } from "@/lib/content/dirs";
import { readDashboardEnvLocalFile } from "@/lib/dashboard-env-local";

/** Where the key came from: Setup's own store, the server environment, or the repo's .env. */
export type TypesafeKeySource = "setup" | "env" | "repo-env";

function repoEnvKey(): string | undefined {
  try { return parseEnv(fs.readFileSync(path.join(getRepoRoot(), ".env"), "utf8")).TYPESAFE_API_KEY?.trim() || undefined; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("Could not read the QA credential file."); }
}

/**
 * Setup's store first (so a key saved in Setup wins without a restart), then the server
 * environment, then the repo's .env. Reads just this credential; never loads or exposes
 * the rest of a repo's environment.
 */
export function resolveTypesafeApiKey(): { key: string; source: TypesafeKeySource } | null {
  const saved = readDashboardEnvLocalFile().overrides.get("TYPESAFE_API_KEY")?.trim();
  if (saved) return { key: saved, source: "setup" };
  const env = process.env.TYPESAFE_API_KEY?.trim();
  if (env) return { key: env, source: "env" };
  const file = repoEnvKey();
  return file ? { key: file, source: "repo-env" } : null;
}

export function typesafeApiKey(): string | undefined {
  return resolveTypesafeApiKey()?.key;
}
