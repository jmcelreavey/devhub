/**
 * First-run consent per (provider, repo): the second part of the dispatch
 * consent model. A dispatched run auto-runs with approvals off — that is the
 * design — but the FIRST time a given provider is aimed at a given repo, the
 * run queues behind the dock's confirm chip instead of injecting silently, so
 * a prompt-injected dispatch into a repo the user has never sent this agent to
 * gets one visible human checkpoint. Approval records the consent; later runs
 * of the same provider+repo auto-run again.
 *
 * Stored in the app data dir (not the OS temp runs dir, which is transient) as
 * plain JSON, 0600. DEVHUB_AGENT_TRUST_ALL=1 short-circuits the check for
 * people who find even one chip per repo annoying.
 */
import fs from "node:fs";
import path from "node:path";
import { defaultAppDataDir } from "@/lib/desktop/runtime-paths";

export function agentConsentFile(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.DEVHUB_AGENT_CONSENT_FILE?.trim() ||
    path.join(defaultAppDataDir(env.HOME), "agent-consent.json")
  );
}

export function consentKey(provider: string, repoKey: string): string {
  return `${provider}::${repoKey}`;
}

/** `${provider}::${repoRoot}` → epoch ms of approval. */
export function readConsents(file: string): Record<string, number> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function hasConsented(file: string, provider: string, repoKey: string): boolean {
  return readConsents(file)[consentKey(provider, repoKey)] !== undefined;
}

export function recordConsent(file: string, provider: string, repoKey: string, now = Date.now()): void {
  const all = readConsents(file);
  all[consentKey(provider, repoKey)] = now;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
