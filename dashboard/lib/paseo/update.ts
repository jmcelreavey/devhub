import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withPaseo } from "./client";
import { execExternal } from "@/lib/exec-external";
import { readPaseoManaged } from "./managed";

export interface PaseoUpdate {
  installed: string | null;
  latest: string | null;
  available: boolean;
  installable?: string;
  canUpdate?: boolean;
  checkedAt: number;
  error?: string;
}
const HOUR = 60 * 60 * 1000;
let cached: { latest: string | null; installable?: string; checkedAt: number; error?: string } | undefined;
let pending: Promise<void> | undefined;
export function newerVersion(candidate: string, installed: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(candidate)) return false;
  const a = candidate.split(".").map(Number);
  const b = installed.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(b[i])) return false;
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** A release can be visible while one of its dependencies is still held by Safe-Chain. */
async function canInstallRelease(version: string): Promise<boolean> {
  const probe = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-paseo-update-"));
  try {
    await execExternal("aikido-npm", ["install", "--prefix", probe, "--dry-run", "--ignore-scripts", "--no-audit", "--no-fund", `@getpaseo/cli@${version}`], { timeoutMs: 45_000, maxBuffer: 128_000, label: "paseo:update-readiness" });
    return true;
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string" && /\b(?:ETARGET|E404)\b/.test(stderr)) return false;
    throw error;
  } finally { await fs.rm(probe, { recursive: true, force: true }); }
}

/** Cache public registry metadata; a failed check must never look like "up to date". */
export async function checkPaseoUpdate(force = false): Promise<PaseoUpdate> {
  const installed = readPaseoManaged()?.version ?? null;
  if (!installed) return { installed, latest: null, available: false, checkedAt: Date.now() };
  const ttl = cached?.error ? 60_000 : HOUR;
  if (force || !cached || Date.now() - cached.checkedAt > ttl) {
    pending ??= (async () => {
      try {
        const response = await fetch("https://registry.npmjs.org/@getpaseo%2fcli/latest", { signal: AbortSignal.timeout(8000), cache: "no-store" });
        if (!response.ok) throw new Error("Registry unavailable");
        const data = await response.json() as { version?: unknown };
        if (typeof data.version !== "string" || !/^\d+\.\d+\.\d+$/.test(data.version)) throw new Error("Invalid release");
        cached = { latest: data.version, checkedAt: Date.now() };
        const { stdout } = await execExternal("aikido-npm", ["view", "@getpaseo/cli", "version", "--json"], { timeoutMs: 15_000, maxBuffer: 64_000, label: "paseo:update-check" });
        // Safe-Chain writes notices to stdout even with --json; only accept one standalone version.
        const versions = stdout.split(/\r?\n/).map(line => line.trim()).filter(line => /^"\d+\.\d+\.\d+"$/.test(line));
        if (versions.length !== 1) throw new Error("Invalid Safe-Chain release");
        const installable = versions[0].slice(1, -1);
        if (!newerVersion(installable, installed) || await canInstallRelease(installable)) cached.installable = installable;
      } catch {
        cached = { latest: null, checkedAt: Date.now(), error: "Could not check for updates. Try again when online." };
      }
    })().finally(() => { pending = undefined; });
    await pending;
  }
  return { installed, ...cached!, available: cached?.latest ? newerVersion(cached.latest, installed) : false, canUpdate: cached?.installable ? newerVersion(cached.installable, installed) : false };
}

/** An update restarts the daemon. Check every page, including chats started directly in Paseo. */
export async function hasActivePaseoWork(): Promise<boolean> {
  return withPaseo(async ({ api }) => {
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await api.agents.list({ scope: "active", page: { limit: 200, ...(cursor ? { cursor } : {}) } });
      if (page.entries.some(({ agent }) => agent.status === "running" || agent.status === "initializing" || agent.pendingPermissions.length > 0)) return true;
      if (!page.pageInfo.hasMore) return false;
      const next = page.pageInfo.nextCursor ?? undefined;
      if (!next || seen.has(next)) throw new Error("Could not verify that all chats are idle.");
      seen.add(next);
      cursor = next;
    } while (cursor);
    return false;
  });
}
