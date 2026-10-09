/**
 * Building the reviewed plan: what the plugin adds, where it would land, and
 * the digest that binds a confirmation to exactly this plan.
 */
import crypto from "node:crypto";
import path from "node:path";
import { getResourceRoot } from "@/lib/desktop/runtime-paths";
import { toolEnv, type PluginContext } from "./context";
import { destinationFingerprint, visibleSyncTargets, type SyncTarget } from "./install";
import { inspectPluginDir, namesOnDisk, type InspectResult, type InspectedAsset } from "./inspect";
import type { AccessView, PluginPreview, TargetPreview } from "./model";
import { readManifestDetailed } from "./manifest";
import { expandHome } from "./registry";
import { registryRevision } from "./registry-write";
import { serviceRuntime, shortSha, tildePath, commandOnPath } from "./runtime";
import { accessCommands, type ParsedGitHubRepo } from "./source";
import { PREVIEW_TTL_MS, readReceipt, type AssetHash, type StoredOperation } from "./store";
import { rows } from "./views";
import { pathExists, safePath } from "./filesystem";

export interface SourceFacts {
  url: string | null;
  owner: string | null;
  repo: string | null;
  branch: string | null;
  sha: string | null;
  visibility: "public" | "private" | null;
  managed: boolean;
  /** Where the download will be (or is) kept. */
  destination: string | null;
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record).sort().reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortValue(record[key]);
      return acc;
    }, {});
  }
  return value;
}

export function stable(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function coreNames(ctx: PluginContext): { skills: Set<string>; agents: Set<string> } {
  const root = ctx.repoRoot ?? getResourceRoot();
  const skills = namesOnDisk(path.join(root, "skills", "shared"), "skill");
  for (const name of namesOnDisk(path.join(root, "skills", "vendor"), "skill")) skills.add(name);
  return { skills, agents: namesOnDisk(path.join(root, "agents", "shared"), "agent") };
}

/** Skill and agent names other enabled plugins already provide. */
function otherPluginNames(ctx: PluginContext, allowName: string | null): { skills: Map<string, string>; agents: Map<string, string> } {
  const maps = { skills: new Map<string, string>(), agents: new Map<string, string>() };
  for (const row of rows(ctx)) {
    if (!row.enabled || !row.name || row.name === allowName) continue;
    const dir = expandHome(row.path, ctx.home);
    const manifest = readManifestDetailed(dir);
    if (!manifest.ok) continue;
    for (const [rel, kind] of [[manifest.manifest.contributes.skills, "skill"], [manifest.manifest.contributes.agents, "agent"]] as const) {
      if (!rel) continue;
      const abs = path.resolve(dir, rel);
      if (abs !== dir && !abs.startsWith(dir + path.sep)) continue;
      const map = kind === "skill" ? maps.skills : maps.agents;
      for (const name of namesOnDisk(abs, kind)) if (!map.has(name)) map.set(name, row.name);
    }
  }
  return maps;
}

export function inspectTree(ctx: PluginContext, root: string, allowName: string | null): InspectResult {
  const core = coreNames(ctx);
  const others = otherPluginNames(ctx, allowName);
  return inspectPluginDir(root, {
    coreSkills: core.skills,
    coreAgents: core.agents,
    otherSkills: others.skills,
    otherAgents: others.agents,
    env: toolEnv(ctx),
  });
}

/** A same-name registration blocks the install; the message is the one the person reads. */
export function nameCollision(ctx: PluginContext, name: string, allowId: string | null): string | null {
  const hit = rows(ctx).find((entry) => entry.name === name && entry.id !== allowId);
  if (!hit) return null;
  return `A plugin named ${name} is already registered from another location. Your existing plugin hasn’t changed.`;
}

function agentDestinations(target: SyncTarget, agent: InspectedAsset): string[] {
  return target.agentDirs.map((dir) => path.join(dir, `${agent.preview.name}.md`));
}

function skillDestination(target: SyncTarget, skill: InspectedAsset): string | null {
  return target.skillDir ? path.join(target.skillDir, skill.preview.name) : null;
}

/**
 * Marks, on each asset, the tools whose copy would collide with something
 * DevHub did not install, and returns the per-tool rows for the review.
 */
export function targetRows(ctx: PluginContext, inspected: InspectResult): TargetPreview[] {
  const targets = visibleSyncTargets(ctx.paths.targetHome);
  for (const asset of [...inspected.skills, ...inspected.agents]) asset.preview.conflictTargets = [];
  const conflicted = new Set<string>();
  for (const target of targets) {
    for (const skill of inspected.skills) {
      const dest = skillDestination(target, skill);
      if (skill.preview.status === "add" && dest && (!safePath(ctx.paths.targetHome, dest) || pathExists(dest))) {
        skill.preview.conflictTargets.push(target.id);
        conflicted.add(target.id);
      }
    }
    for (const agent of inspected.agents) {
      if (agent.preview.status === "add" && agentDestinations(target, agent).some((dest) => !safePath(ctx.paths.targetHome, dest) || pathExists(dest))) {
        agent.preview.conflictTargets.push(target.id);
        conflicted.add(target.id);
      }
    }
  }
  return targets.map((target) => ({
    id: target.id,
    label: target.label,
    pathLabel: [...(inspected.skills.some((asset) => asset.preview.status === "add") && target.skillDir ? [target.skillDir] : []), ...(inspected.agents.some((asset) => asset.preview.status === "add") ? target.agentDirs : [])].map((dir) => tildePath(dir, ctx.paths.targetHome)).join(" · ") || "No compatible assets",
    selectedByDefault: target.selectedByDefault && !conflicted.has(target.id),
    conflict: conflicted.has(target.id) ? "Conflicts with a local copy" : null,
  }));
}

/** What every destination looked like at review time. Compared again before anything is written. */
export function fingerprintMap(ctx: PluginContext, inspected: InspectResult): Record<string, string> {
  const map: Record<string, string> = {};
  for (const target of visibleSyncTargets(ctx.paths.targetHome)) {
    for (const skill of inspected.skills) {
      const dest = skillDestination(target, skill);
      if (skill.preview.status === "add" && dest) map[`${target.id}:skill:${skill.preview.name}`] = safePath(ctx.paths.targetHome, dest) ? destinationFingerprint(dest, "skill") : "unsafe";
    }
    for (const agent of inspected.agents) {
      if (agent.preview.status !== "add") continue;
      for (const dest of agentDestinations(target, agent)) map[`${target.id}:agent:${agent.preview.name}:${dest}`] = safePath(ctx.paths.targetHome, dest) ? destinationFingerprint(dest, "agent") : "unsafe";
    }
  }
  return map;
}

export function assetHashes(inspected: InspectResult): AssetHash[] {
  return [
    ...inspected.skills.map((asset) => ({ kind: "skill" as const, name: asset.preview.name, hash: asset.bytesHash })),
    ...inspected.agents.map((asset) => ({ kind: "agent" as const, name: asset.preview.name, hash: asset.bytesHash })),
  ];
}

/** Do the files under `root` still hash to what was reviewed? */
export function hashesMatch(ctx: PluginContext, root: string, hashes: AssetHash[], sourceHash?: string | null): boolean {
  const inspected = inspectPluginDir(root, { env: toolEnv(ctx) });
  if (inspected.fatal) return false;
  if (sourceHash !== undefined && inspected.treeHash !== sourceHash) return false;
  for (const asset of hashes) {
    const pool = asset.kind === "skill" ? inspected.skills : inspected.agents;
    const found = pool.find((item) => item.preview.name === asset.name);
    if (!found || found.bytesHash !== asset.hash) return false;
  }
  return inspected.skills.length + inspected.agents.length === hashes.length;
}

export function fingerprintsMatch(ctx: PluginContext, stored: StoredOperation, selected: string[]): boolean {
  const root = stored.internal.workTree;
  if (!root) return false;
  const inspected = inspectTree(ctx, root, stored.view.kind === "enable" ? stored.view.preview?.plugin?.name ?? null : null);
  if (inspected.fatal) return false;
  if (inspected.manifestHash !== stored.internal.manifestHash || !inspected.requirementsMet || inspected.blockers.length > 0) return false;
  const current = fingerprintMap(ctx, inspected);
  for (const [key, value] of Object.entries(stored.internal.fingerprints)) {
    if (!selected.includes(key.split(":")[0])) continue;
    if (current[key] !== value) return false;
  }
  return hashesMatch(ctx, root, stored.internal.assetHashes, stored.internal.sourceHash ?? null);
}

export function toPreview(
  ctx: PluginContext,
  operationId: string,
  revision: number,
  inspected: InspectResult,
  source: SourceFacts,
  nameTaken: string | null,
): PluginPreview {
  const targets = targetRows(ctx, inspected);
  const fingerprints = fingerprintMap(ctx, inspected);
  const registryRev = registryRevision(ctx.home, ctx.env);
  const blockers = [...inspected.blockers];
  if (nameTaken) blockers.push({ code: "NAME_CONFLICT", message: nameTaken });
  const canApply = !inspected.fatal && blockers.length === 0 && inspected.requirementsMet;
  let heading = inspected.heading;
  let body = inspected.body;
  if (!inspected.fatal && nameTaken) {
    heading = nameTaken;
    body = null;
  } else if (!inspected.fatal && inspected.blockers.some((item) => item.code === "UNSUPPORTED")) {
    heading = "This plugin needs features this installer can’t apply";
    body = inspected.blockers.find((item) => item.code === "UNSUPPORTED")?.message ?? null;
  }
  const digest = sha256(stable({
    sha: source.sha,
    manifestHash: inspected.manifestHash,
    treeHash: inspected.treeHash,
    assets: [...inspected.skills, ...inspected.agents].map((asset) => ({ name: asset.preview.name, status: asset.preview.status, hash: asset.bytesHash })),
    requirements: inspected.requirements.map((item) => ({ command: item.command, available: item.available })),
    unsupported: inspected.unsupported,
    registryRev,
    fingerprints,
  }));
  return {
    operationId,
    revision,
    runtime: inspected.manifest?.runtime,
    planDigest: digest,
    expiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
    plugin: inspected.manifest ? { name: inspected.manifest.name, version: inspected.manifest.version, devhubApi: "1" } : null,
    source: {
      url: source.url,
      owner: source.owner,
      repo: source.repo,
      ref: source.branch,
      sha: source.sha,
      shortSha: shortSha(source.sha),
      visibility: source.visibility,
      managed: source.managed,
      destination: source.destination,
    },
    contributions: {
      skills: inspected.skills.map((asset) => asset.preview),
      agents: inspected.agents.map((asset) => asset.preview),
    },
    declaredIgnored: inspected.declaredIgnored,
    unsupported: inspected.unsupported,
    inventory: inspected.inventory,
    requirements: inspected.requirements,
    requirementsMet: inspected.requirementsMet,
    targets,
    conflicts: [],
    blockers,
    registryRevision: registryRev,
    canApply,
    heading,
    body,
  };
}

/** The preview for disabling or removing: no contributions, only what would be touched. */
export function lifecyclePreview(ctx: PluginContext, stored: StoredOperation, entry: { id: string; name: string; url: string | null; sha: string | null; ref: string | null; managed: boolean; path: string }, version: string): PluginPreview {
  const receipt = readReceipt(ctx, entry.id);
  const targets: TargetPreview[] = visibleSyncTargets(ctx.paths.targetHome).filter((target) => receipt?.files.some((file) => file.tool === target.id)).map((target) => ({
    id: target.id,
    label: target.label,
    pathLabel: [...new Set(receipt?.files.filter((file) => file.tool === target.id).map((file) => path.dirname(file.destination)))].map((dir) => tildePath(dir, ctx.paths.targetHome)).join(" · "),
    selectedByDefault: false,
    conflict: null,
  }));
  const revision = registryRevision(ctx.home, ctx.env);
  return {
    operationId: stored.view.id,
    revision: 1,
    planDigest: sha256(stable({ kind: stored.view.kind, id: entry.id, registry: revision, receipt })),
    expiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
    plugin: { name: entry.name, version, devhubApi: "1" },
    source: {
      url: entry.url,
      owner: null,
      repo: null,
      ref: entry.ref,
      sha: entry.sha,
      shortSha: shortSha(entry.sha),
      visibility: null,
      managed: entry.managed,
      destination: tildePath(expandHome(entry.path, ctx.home), ctx.home),
    },
    contributions: { skills: [], agents: [] },
    declaredIgnored: [],
    unsupported: [],
    inventory: [],
    requirements: [],
    requirementsMet: true,
    targets,
    conflicts: [],
    blockers: [],
    registryRevision: revision,
    canApply: true,
    heading: null,
    body: null,
  };
}

export function accessView(
  ctx: PluginContext,
  repo: ParsedGitHubRepo,
  gh: { available: boolean; login: string | null; label: string },
  signedInDenied: boolean,
  gitAvailable = true,
): AccessView {
  const runtime = serviceRuntime(ctx.env);
  const env = toolEnv(ctx);
  const commands = accessCommands(repo, runtime.kind, env);
  return {
    owner: repo.owner,
    repo: repo.repo,
    ghStatus: gh.label,
    gitStatus: "Couldn’t access this repository",
    runtimeLabel: runtime.label,
    login: gh.login,
    ghAvailable: gh.available,
    brewHint: !gh.available && commandOnPath("brew", env),
    commands: commands.gh,
    gitCommands: commands.git,
    signedInDenied,
    gitAvailable,
  };
}
