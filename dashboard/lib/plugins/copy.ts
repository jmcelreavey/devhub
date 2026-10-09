/**
 * Wording shared by the API (which writes results into operation records) and
 * the Plugins page. Pure functions, no Node imports.
 */
import type { PluginOperationState } from "./model";

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "4 skills and 1 agent added" */
export function addedSummary(skills: number, agents: number): string {
  const parts = [skills > 0 ? plural(skills, "skill") : null, agents > 0 ? plural(agents, "agent") : null].filter(Boolean);
  return parts.length ? `${parts.join(" and ")} added` : "No skills or agents were added";
}

export const NOT_COPIED = "Added to DevHub. Nothing was copied to your AI tools.";

export function syncSummary(targets: readonly string[]): string {
  return targets.length ? `Synced to ${joinAnd(targets)}` : NOT_COPIED;
}

export function keptSummary(count: number): string {
  return count === 1
    ? "1 local copy was kept because it changed after installation."
    : `${count} local copies were kept because they changed after installation.`;
}

export interface PhaseCopy {
  /** Shown beside the step in progress. */
  active: string;
  /** One sentence of what is happening, without implying the plugin is enabled. */
  supporting: string;
}

/** Preparation phases, in order. Exact wording. */
export const PHASE_COPY: Partial<Record<PluginOperationState, PhaseCopy>> = {
  validating_url: { active: "Checking repository URL…", supporting: "Checking the repository address." },
  checking_access: { active: "Checking repository access…", supporting: "Using Git and your existing GitHub access." },
  cloning: { active: "Downloading repository…", supporting: "Downloading files for review. The plugin is not enabled." },
  validating: { active: "Validating plugin…", supporting: "Checking devhub-plugin.json and the files it declares." },
  preparing_preview: { active: "Preparing preview…", supporting: "Checking contributions, requirements and name conflicts." },
};

export const NO_CODE_HAS_RUN = "No plugin code has run.";

export const CANCELLING = "Cancelling… Waiting for the current Git command to stop.";

/** Elapsed time as "42s" or "1m 05s". */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
