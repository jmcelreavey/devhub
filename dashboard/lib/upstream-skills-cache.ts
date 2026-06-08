import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface UpstreamSkillsManifest {
  checkoutRoot: string;
  repo: string;
  branch: string;
  commit: string;
  skillsDir: string;
  updatedAt: string;
}

function cacheBaseDir(): string {
  return path.join(os.homedir(), ".cache", "devhub", "ai-tools-upstream");
}

function manifestPath(): string {
  return path.join(cacheBaseDir(), "manifest.json");
}

export function skillsCacheExtractRoot(fullName: string, branch: string): string {
  return path.join(cacheBaseDir(), fullName.replace("/", "--"), branch);
}

export function skillsCacheDir(fullName: string, branch: string): string {
  return path.join(skillsCacheExtractRoot(fullName, branch), "skills");
}

export function readUpstreamSkillsManifest(): UpstreamSkillsManifest | null {
  try {
    const raw = fs.readFileSync(manifestPath(), "utf-8");
    const parsed = JSON.parse(raw) as UpstreamSkillsManifest;
    if (!parsed.skillsDir || !parsed.checkoutRoot) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeUpstreamSkillsManifest(manifest: UpstreamSkillsManifest): void {
  fs.mkdirSync(cacheBaseDir(), { recursive: true });
  fs.writeFileSync(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Cached skills dir when it matches this checkout and still exists on disk. */
export function resolveCachedSkillsDir(checkoutRoot: string): string | null {
  const manifest = readUpstreamSkillsManifest();
  if (!manifest) return null;
  if (path.resolve(manifest.checkoutRoot) !== path.resolve(checkoutRoot)) return null;
  if (!fs.existsSync(manifest.skillsDir) || !fs.statSync(manifest.skillsDir).isDirectory()) {
    return null;
  }
  return manifest.skillsDir;
}

export function upstreamSkillsCommit(checkoutRoot: string): string | undefined {
  const manifest = readUpstreamSkillsManifest();
  if (!manifest) return undefined;
  if (path.resolve(manifest.checkoutRoot) !== path.resolve(checkoutRoot)) return undefined;
  return manifest.commit;
}
