import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listEnabledPlugins } from "./plugins/registry";

export function listAwsProfiles(home = os.homedir()): string[] {
  const profiles = new Set<string>();
  for (const file of [path.join(home, ".aws", "config"), path.join(home, ".aws", "credentials")]) {
    if (!fs.existsSync(file)) continue;
    try {
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const match = line.trim().match(/^\[(.+)\]$/);
        if (match) profiles.add(match[1].replace(/^profile\s+/, "").trim());
      }
    } catch (error) {
      console.warn("Could not read AWS profiles", error instanceof Error ? error.message : String(error));
    }
  }
  return [...profiles].filter(Boolean).sort();
}

export interface InfrastructurePresence {
  infra: boolean;
  awsProfile: string | null;
  scriptsRepoPath: string | null;
}

export function detectInfrastructurePresence(resolve: (key: string) => string | null | undefined, home = os.homedir()): InfrastructurePresence {
  const awsProfile = resolve("AWS_PROFILE") ?? process.env.AWS_PROFILE ?? null;
  const profiles = listAwsProfiles(home);
  const scriptsRepoPath = resolve("AUTOMATION_REPO_PATH") ?? null;
  const pluginEnabled = listEnabledPlugins(home).some((entry) => entry.manifest.navGate === "infra");
  return { infra: pluginEnabled || !!(awsProfile || profiles.length || scriptsRepoPath), awsProfile: awsProfile ?? profiles[0] ?? null, scriptsRepoPath };
}
