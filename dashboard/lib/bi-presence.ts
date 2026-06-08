/**
 * Lightweight, dependency-free detection of whether BI tooling is configured on this
 * machine — enough to drive the `bi` nav gate without importing the BI feature libs
 * (`bi-ops`, `bi-iam-config`). Those libs are extracted to the `devhub-bi` plugin; the
 * rich identity/team/account data lives behind the plugin's `/ops` + `/api/bi` routes.
 *
 * Contains no company-internal names or logic — just generic AWS-profile/env detection.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Profile names from ~/.aws/{config,credentials}. Generic AWS, not BI-specific. */
export function listAwsProfiles(home = os.homedir()): string[] {
  const files = [path.join(home, ".aws", "config"), path.join(home, ".aws", "credentials")];
  const profiles = new Set<string>();
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    try {
      for (const line of fs.readFileSync(file, "utf-8").split(/\r?\n/)) {
        const m = line.trim().match(/^\[(.+)\]$/);
        if (!m) continue;
        // config uses "[profile name]"; credentials uses "[name]".
        profiles.add(m[1].replace(/^profile\s+/, "").trim());
      }
    } catch {
      // best-effort detection only
    }
  }
  return [...profiles].filter(Boolean).sort();
}

export interface BiPresence {
  /** True when any BI tooling signal is configured. Drives the `bi` nav gate. */
  bi: boolean;
  /** Preferred AWS profile (env first, else first configured), or null. */
  awsProfile: string | null;
  capiRepoPath: string | null;
}

/**
 * Detect BI presence from env overrides + ~/.aws. `resolve` reads a configured env value
 * (mirrors resolveEnvValue from dashboard-env-local) so callers pass their override map.
 */
export function detectBiPresence(
  resolve: (key: string) => string | null | undefined,
  home = os.homedir(),
): BiPresence {
  const awsProfileEnv = resolve("AWS_PROFILE") ?? process.env.AWS_PROFILE ?? null;
  const profiles = listAwsProfiles(home);
  const biEmail = resolve("BI_OPS_USER_EMAIL") ?? null;
  const capiRepoPath = resolve("CAPI_REPO_PATH") ?? null;

  const bi = !!(awsProfileEnv || profiles.length > 0 || biEmail || capiRepoPath);
  return {
    bi,
    awsProfile: awsProfileEnv ?? profiles[0] ?? null,
    capiRepoPath,
  };
}
