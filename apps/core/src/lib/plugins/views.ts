import { rowFrom, text, type RegistryRow, type RawEntry } from "./registry-row";
export { rowFrom, type RegistryRow } from "./registry-row";
/**
 * The registry as the Plugins page shows it. Reads are tolerant: a broken
 * entry stays visible with what is wrong, because hiding it would leave
 * nothing to act on. Writes elsewhere stay strict.
 */
import fs from "node:fs";
import { PluginApiError, type PluginContext } from "./context";
import { summarisePluginDir } from "./inspect";
import { listSyncTargets } from "./install";
import type { PluginDetail, PluginListItem } from "../../../../../packages/shared/ui-lib/plugins/model";
import { expandHome } from "./registry";
import { readReceipt } from "./store";
import { tildePath, shortSha } from "./runtime";

export interface RawRegistry {
  entries: RawEntry[];
  /** Why the file could not be read in full, or null. */
  problem: string | null;
}

export const REGISTRY_UNREADABLE = "DevHub couldn’t read plugins.json safely. No settings have been changed.";

/** Everything recoverable from the registry file; never throws and never writes. */
export function readRawRegistry(ctx: PluginContext): RawRegistry {
  const file = ctx.paths.registryPath;
  if (!fs.existsSync(file)) return { entries: [], problem: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { entries: [], problem: REGISTRY_UNREADABLE };
  }
  const list = parsed && typeof parsed === "object" ? (parsed as { plugins?: unknown }).plugins : undefined;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { entries: [], problem: REGISTRY_UNREADABLE };
  if (list === undefined) return { entries: [], problem: null };
  if (!Array.isArray(list)) return { entries: [], problem: REGISTRY_UNREADABLE };
  const entries = list.filter((item): item is RawEntry => Boolean(item) && typeof item === "object" && text((item as RawEntry).path) !== null);
  return { entries, problem: entries.length === list.length ? null : REGISTRY_UNREADABLE };
}

export function rows(ctx: PluginContext): RegistryRow[] {
  return readRawRegistry(ctx).entries.map(rowFrom);
}

export function findEntry(ctx: PluginContext, idOrName: string): RegistryRow | null {
  return rows(ctx).find((entry) => entry.id === idOrName || (entry.name !== "" && entry.name === idOrName)) ?? null;
}

function duplicateNames(all: RegistryRow[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of all) {
    if (!row.name) continue;
    if (seen.has(row.name)) duplicates.add(row.name);
    seen.add(row.name);
  }
  return duplicates;
}

function githubSlug(url: string): string | null {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

interface Summary {
  item: PluginListItem;
  abs: string;
  version: string | null;
  hasService: boolean;
}

function summarise(ctx: PluginContext, row: RegistryRow, duplicates: Set<string>): Summary {
  const abs = expandHome(row.path, ctx.home);
  let folder: ReturnType<typeof summarisePluginDir>;
  try { folder = summarisePluginDir(abs); }
  catch { folder = { problem: "manifest_invalid", manifest: null, skills: 0, agents: 0 }; }
  let attention: string | null = null;
  if (folder.problem === "folder_missing") attention = "Plugin folder not found";
  else if (folder.problem === "manifest_invalid") attention = "Manifest is invalid";
  else if (row.name && folder.manifest && folder.manifest.name !== row.name) attention = "Registry name does not match the manifest";
  else if (row.name && duplicates.has(row.name)) attention = "Duplicate plugin name";
  else if (row.managed && !readReceipt(ctx, row.id)) attention = "Installation record is missing or unreadable";
  const state = attention ? "needs_attention" : !row.enabled ? "disabled" : row.managed ? "enabled" : "local";
  const stateLabel = { needs_attention: "Needs attention", disabled: "Disabled", local: "Local folder", enabled: "Enabled" }[state];
  const slug = row.url ? githubSlug(row.url) : null;
  return {
    item: {
      id: row.id,
      runtime: Boolean(folder.manifest?.runtime),
      ...(folder.manifest?.runtime && !row.managed ? { localRuntimePath: abs } : {}),
      name: row.name || folder.manifest?.name || "(unnamed)",
      state,
      stateLabel,
      sourceLabel: slug ?? tildePath(abs, ctx.home),
      ref: row.ref,
      shortSha: shortSha(row.sha),
      skills: folder.skills,
      agents: folder.agents,
      managed: row.managed,
      attention,
    },
    abs,
    version: folder.manifest?.version ?? null,
    hasService: Boolean(folder.manifest?.runtime?.capabilities?.service),
  };
}

export interface RegistrationFacts {
  item: PluginListItem;
  row: RegistryRow;
  /** Absolute folder. */
  abs: string;
  version: string | null;
}

/** Every registration with its state worked out, for the page and the CLI alike. */
export function describeRegistrations(ctx: PluginContext): { facts: RegistrationFacts[]; problem: string | null } {
  const raw = readRawRegistry(ctx);
  const all = raw.entries.map(rowFrom);
  const duplicates = duplicateNames(all);
  const facts = all.map((row) => {
    const { item, abs, version } = summarise(ctx, row, duplicates);
    return { item, row, abs, version };
  });
  return { facts, problem: raw.problem };
}

export interface PluginListResult {
  /** False when the registry could not be read in full; `plugins` is then what could be recovered. */
  ok: boolean;
  plugins: PluginListItem[];
  diagnostic: string | null;
  malformed: boolean;
}

export function listRegistrations(ctx: PluginContext): PluginListResult {
  const { facts, problem } = describeRegistrations(ctx);
  const plugins = facts.map((fact) => fact.item);
  return problem
    ? { ok: false, plugins, diagnostic: problem, malformed: true }
    : { ok: true, plugins, diagnostic: ctx.paths.registryDiagnostic, malformed: false };
}

const LAST_OPERATION_LABEL: Record<string, string> = { install: "Enabled", enable: "Enabled", disable: "Disabled" };

export function getRegistration(ctx: PluginContext, idOrName: string): PluginDetail {
  const raw = readRawRegistry(ctx);
  if (raw.problem && raw.entries.length === 0) throw new PluginApiError(409, "REGISTRY", REGISTRY_UNREADABLE);
  const all = raw.entries.map(rowFrom);
  const row = all.find((entry) => entry.id === idOrName || (entry.name !== "" && entry.name === idOrName));
  if (!row) throw new PluginApiError(404, "NOT_FOUND", "That plugin is not registered.");
  const { item, abs, version, hasService } = summarise(ctx, row, duplicateNames(all));
  const receipt = row.managed ? readReceipt(ctx, row.id) : null;
  const labels = new Map(listSyncTargets(ctx.paths.targetHome).map((target) => [target.id, target.label]));
  const syncedTo = receipt ? [...new Set(receipt.files.map((file) => labels.get(file.tool) ?? file.tool))] : [];
  const last = row.lastOperation ?? (row.installedAt ? { kind: "install", at: row.installedAt } : null);
  return {
    ...item,
    hasService,
    version,
    sha: row.sha,
    locationLabel: row.managed ? "Managed by DevHub" : "Local folder",
    path: abs,
    pathDisplay: tildePath(abs, ctx.home),
    githubUrl: row.url && githubSlug(row.url) ? row.url : null,
    syncedTo,
    localNote: row.managed ? null : "This plugin is registered from a folder you manage. DevHub won’t move, update or delete that folder.",
    lastOperation: last ? { label: LAST_OPERATION_LABEL[last.kind] ?? "Updated", at: last.at } : null,
    // Folders registered by path stay observational until reviewed adoption exists.
    canDisable: row.managed && Boolean(receipt) && (row.enabled || Boolean(receipt?.files.length)),
    canRemove: row.managed && Boolean(receipt),
    canEnable: row.managed && Boolean(receipt) && !row.enabled && !item.attention && !receipt?.files.length,
  };
}
