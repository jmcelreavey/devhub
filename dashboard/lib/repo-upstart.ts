import fs from "node:fs";
import path from "node:path";
import { getUpstartsDir } from "./content-dirs";

/** Personal-data store under the DevHub private mirror (not the target repo). */
export const UPSTARTS_SEGMENT = "upstarts";
export const UPSTART_SCRIPT_NAME = "upstart.sh";
/** Legacy location inside each scanned project — migrated into DevHub on detect. */
export const LEGACY_UPSTART_RELATIVE = path.join(".devhub", "upstart.sh");

export function sanitizeUpstartRepoName(name: string): string {
  const trimmed = name.trim();
  if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed) || trimmed.includes("..")) {
    throw new Error("Invalid local repo name");
  }
  return trimmed;
}

/** Repo-relative POSIX path: `upstarts/<repo>/upstart.sh`. */
export function upstartScriptRelativePath(repoName: string): string {
  const name = sanitizeUpstartRepoName(repoName);
  return `${UPSTARTS_SEGMENT}/${name}/${UPSTART_SCRIPT_NAME}`;
}

/**
 * Absolute path to the DevHub-managed upstart script for a scanned repo.
 * Always under `getUpstartsDir()` — never inside the target project.
 */
export function resolveUpstartScriptPath(repoName: string): string {
  const name = sanitizeUpstartRepoName(repoName);
  const base = path.resolve(getUpstartsDir());
  const dir = path.resolve(base, name);
  if (path.dirname(dir) !== base) {
    throw new Error("Invalid upstart path");
  }
  return path.join(dir, UPSTART_SCRIPT_NAME);
}

export function resolveLegacyUpstartPath(targetRepoPath: string): string {
  return path.join(targetRepoPath, LEGACY_UPSTART_RELATIVE);
}

/**
 * If the private store is empty but the target still has `.devhub/upstart.sh`,
 * copy it once into DevHub. Leaves the legacy file untouched.
 */
export function importLegacyUpstartIfNeeded(repoName: string, targetRepoPath: string): boolean {
  const dest = resolveUpstartScriptPath(repoName);
  if (fs.existsSync(dest)) return true;

  const legacy = resolveLegacyUpstartPath(targetRepoPath);
  if (!fs.existsSync(legacy)) return false;

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(legacy, dest);

  const notePath = path.join(path.dirname(dest), "MIGRATED.txt");
  if (!fs.existsSync(notePath)) {
    fs.writeFileSync(
      notePath,
      [
        `Imported from ${legacy}`,
        "The original .devhub/upstart.sh in the target repo was left in place.",
        "Prefer editing this DevHub copy; you can delete the legacy file when ready.",
        "",
      ].join("\n"),
      "utf-8",
    );
  }
  return true;
}

/** True when the DevHub-managed script exists (after optional one-shot legacy import). */
export function detectRepoUpstart(repoName: string, targetRepoPath: string): boolean {
  try {
    if (fs.existsSync(resolveUpstartScriptPath(repoName))) return true;
    return importLegacyUpstartIfNeeded(repoName, targetRepoPath);
  } catch {
    // Odd folder names that fail sanitize — treat as no managed upstart.
    return false;
  }
}

/** Absolute managed path, or empty string when the repo name is not safe. */
export function safeUpstartScriptPath(repoName: string): string {
  try {
    return resolveUpstartScriptPath(repoName);
  } catch {
    return "";
  }
}
