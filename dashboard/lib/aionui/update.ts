import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { AIONUI_RELEASE } from "@/lib/aionui/connection";

const releaseSchema = z.object({ tag_name: z.string().regex(/^v\d+\.\d+\.\d+$/) });
const manifestSchema = z.object({ ui: z.string().optional(), core: z.string(), origin: z.string() });

export interface AionUpdateStatus { installed: boolean; currentVersion?: string; latestVersion?: string; available: boolean; }

const CACHE_TTL_MS = 15 * 60_000;
let cached: { currentVersion: string; expiresAt: number; status: AionUpdateStatus } | undefined;

function parts(version: string): number[] { return version.replace(/^v/, "").split(".").map(Number); }
export function isNewerVersion(latest: string, current: string): boolean {
  const left = parts(latest), right = parts(current);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

export async function aionUpdateStatus(fetcher: typeof fetch = fetch): Promise<AionUpdateStatus> {
  const file = path.join(os.homedir(), ".config", "devhub", "aionui-managed.json");
  if (!fs.existsSync(file)) return { installed: false, available: false };
  const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  const currentVersion = manifest.ui ?? AIONUI_RELEASE.ui;
  if (cached?.currentVersion === currentVersion && cached.expiresAt > Date.now()) return cached.status;
  const response = await fetcher("https://api.github.com/repos/iOfficeAI/AionUi/releases/latest", { headers: { Accept: "application/vnd.github+json", "User-Agent": "DevHub" }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return { installed: true, currentVersion, available: false };
  const latestVersion = releaseSchema.parse(await response.json()).tag_name.slice(1);
  const status = { installed: true, currentVersion, latestVersion, available: isNewerVersion(latestVersion, currentVersion) };
  cached = { currentVersion, expiresAt: Date.now() + CACHE_TTL_MS, status };
  return status;
}
