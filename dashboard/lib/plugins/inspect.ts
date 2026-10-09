/**
 * Read a plugin tree without executing it. Symlinks, hooks and package
 * scripts are inventory, never processes.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseAgentMarkdown } from "@/lib/agent/sync-format";
import { descriptionFromFrontmatter } from "@/lib/skills/shared";
import { readManifestDetailed, type ManifestIssue } from "./manifest";
import type { PluginManifest } from "./types";
import { PLUGIN_LIMITS, assertRepoRelative } from "./source";
import { commandOnPath } from "./runtime";
import type { AssetPreview, InventoryGroup, PreviewIssue, RequirementPreview } from "./model";

export interface InspectIssue {
  code: string;
  /** devhub-plugin.json for manifest problems, otherwise the repository-relative path. */
  file: string;
  /** Dotted manifest field; empty for a file-level problem. */
  field: string;
  message: string;
}

export interface InspectedAsset {
  preview: AssetPreview;
  sourceDir?: string;
  sourceFile?: string;
  bytesHash: string;
}

export interface InspectResult {
  fatal: boolean;
  heading: string | null;
  body: string | null;
  issues: InspectIssue[];
  manifest: PluginManifest | null;
  skills: InspectedAsset[];
  agents: InspectedAsset[];
  requirements: RequirementPreview[];
  requirementsMet: boolean;
  /** Contribution kinds this installer cannot apply, e.g. "MCP servers". */
  unsupported: string[];
  /** What those contributions declare, as inert names and paths. */
  inventory: InventoryGroup[];
  blockers: PreviewIssue[];
  /** Accepted by the manifest schema but not delivered as plugin features. */
  declaredIgnored: string[];
  manifestHash: string | null;
  treeHash: string | null;
}

const UNSAFE_MESSAGE = "A declared file points outside the plugin, or uses a file type DevHub won’t install.";
const INVENTORY_ENTRIES = 50;
const INVENTORY_TEXT = 200;

function sha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function hashFile(file: string): string {
  return sha256(fs.readFileSync(file));
}

/**
 * Identity of a skill folder: every file's path, mode and bytes, in a fixed
 * order, each field length-prefixed so two different trees cannot hash alike.
 */
export function hashSkillDir(dir: string): string {
  const hash = crypto.createHash("sha256");
  const field = (value: Buffer | string) => {
    const bytes = typeof value === "string" ? Buffer.from(value) : value;
    hash.update(String(bytes.length));
    hash.update("\0");
    hash.update(bytes);
  };
  const walk = (abs: string, rel: string) => {
    for (const name of fs.readdirSync(abs).sort()) {
      const child = path.join(abs, name);
      const next = rel ? `${rel}/${name}` : name;
      const stat = fs.lstatSync(child);
      if (stat.isSymbolicLink()) {
        field(`link:${next}`);
        field(fs.readlinkSync(child));
      } else if (stat.isDirectory()) {
        field(`dir:${next}`);
        walk(child, next);
      }
      else if (stat.isFile()) {
        field(next);
        field(String(stat.mode & 0o777));
        field(fs.readFileSync(child));
      } else field(`special:${next}:${stat.mode}`);
    }
  };
  walk(dir, "");
  return hash.digest("hex");
}

export function walkPluginRoot(root: string): InspectIssue[] {
  const issues: InspectIssue[] = [];
  let files = 0;
  let entries = 0;
  let total = 0;
  const seen = new Set<string>();

  function visit(abs: string, rel: string): void {
    if (issues.some((issue) => issue.code === "LIMIT")) return;
    entries += 1;
    if (entries > PLUGIN_LIMITS.maxFiles * 2 || rel.split("/").length > 64) {
      issues.push({ code: "LIMIT", file: rel, field: "", message: "This plugin has too many files or nested folders to review." });
      return;
    }
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(abs);
    } catch {
      issues.push({ code: "UNSAFE", file: rel || "(root)", field: "", message: UNSAFE_MESSAGE });
      return;
    }
    if (stat.isSymbolicLink()) {
      issues.push({ code: "UNSAFE", file: rel || "(root)", field: "", message: "Symlinks are not installed." });
      return;
    }
    if (rel && !assertRepoRelative(rel)) {
      issues.push({ code: "UNSAFE", file: rel, field: "", message: UNSAFE_MESSAGE });
      return;
    }
    const key = rel.normalize("NFC").toLowerCase();
    if (rel && seen.has(key)) {
      issues.push({ code: "UNSAFE", file: rel, field: "", message: "Two files differ only by letter case." });
      return;
    }
    if (rel) seen.add(key);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(abs)) visit(path.join(abs, name), rel ? `${rel}/${name}` : name);
      return;
    }
    if (!stat.isFile()) {
      issues.push({ code: "UNSAFE", file: rel, field: "", message: UNSAFE_MESSAGE });
      return;
    }
    files += 1;
    total += stat.size;
    if (files > PLUGIN_LIMITS.maxFiles || stat.size > PLUGIN_LIMITS.maxFileBytes || total > PLUGIN_LIMITS.maxTotalBytes) {
      issues.push({ code: "LIMIT", file: rel, field: "", message: "This plugin is larger than DevHub will download for review." });
    }
  }

  visit(root, "");
  return issues;
}

/** A manifest-relative folder resolved inside the plugin root, or null if it escapes. */
function contained(root: string, rel: string): string | null {
  const relative = rel.replace(/\/$/, "");
  if (!assertRepoRelative(relative)) return null;
  const realRoot = fs.realpathSync(root);
  const abs = path.resolve(realRoot, relative);
  if (abs !== realRoot && !abs.startsWith(realRoot + path.sep)) return null;
  return abs;
}

/** MCP server packages the existing scanner would install (`mcp-servers/<name>/package.json`). */
function mcpPackageNames(root: string): string[] {
  const servers = path.join(root, "mcp-servers");
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(servers);
  } catch {
    return [];
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return [];
  const found: string[] = [];
  for (const name of fs.readdirSync(servers).sort()) {
    try {
      if (fs.lstatSync(path.join(servers, name)).isDirectory() && fs.lstatSync(path.join(servers, name, "package.json")).isFile()) {
        found.push(name);
      }
    } catch {
      // no package.json here
    }
  }
  return found;
}

function clip(value: string): string {
  return value.length > INVENTORY_TEXT ? `${value.slice(0, INVENTORY_TEXT - 1)}…` : value;
}

function group(kind: string, entries: string[], note: string | null = null): InventoryGroup {
  const unique = [...new Set(entries.map(clip))];
  return { kind, entries: unique.slice(0, INVENTORY_ENTRIES), note, more: Math.max(0, unique.length - INVENTORY_ENTRIES) };
}

function jsonFiles(dir: string | null): string[] {
  if (!dir) return [];
  try {
    return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

/** Names and paths only. Nothing declared here is read, loaded or run. */
function buildInventory(root: string, manifest: PluginManifest, packages: string[]): InventoryGroup[] {
  const groups: InventoryGroup[] = [];
  const mcpRel = manifest.contributes.mcp;
  if (mcpRel || packages.length) {
    const catalogDir = mcpRel ? contained(root, mcpRel) : null;
    const base = (mcpRel ?? "").replace(/\/?$/, "/");
    groups.push(group("MCP servers", [
      ...jsonFiles(catalogDir).map((name) => `${base}${name}`),
      ...packages.map((name) => `mcp-servers/${name}/package.json`),
    ]));
  }
  if (manifest.dashboard) {
    const dash = manifest.dashboard;
    groups.push(group("Dashboard modules", [
      ...dash.paths.map((item) => `${dash.root.replace(/\/$/, "")}/${item}`),
      ...(dash.nav ?? []).map((item) => `Navigation: ${item.label} → ${item.href}`),
      ...(dash.connections ? [`Database provider: ${dash.connections}`] : []),
    ]));
    if (dash.overlays?.length) {
      groups.push(group("Overlays", dash.overlays, "Overlays replace named parts of DevHub."));
    }
  }
  if (manifest.branding) {
    const brand = manifest.branding;
    groups.push(group("Branding", [
      ...(brand.themeCss ? [brand.themeCss] : []),
      ...(brand.presets ? [brand.presets] : []),
      ...(brand.fonts ? [brand.fonts] : []),
      ...(brand.logo ? [brand.logo.src] : []),
      ...(brand.desktopIcon ? [brand.desktopIcon] : []),
    ], "Stylesheets and images are listed, not loaded."));
  }
  if (manifest.contributes.docs) {
    groups.push(group("Docs", [manifest.contributes.docs], "Declared, but not applied by this version of DevHub."));
  }
  if (manifest.contributes.personaModes) {
    groups.push(group("Persona modes", [manifest.contributes.personaModes], "Declared, but not applied by this version of DevHub."));
  }
  return groups;
}

function listSkills(root: string, manifest: PluginManifest): InspectedAsset[] {
  const rel = manifest.contributes.skills;
  const dir = rel ? contained(root, rel) : null;
  if (!rel || !dir || !fs.existsSync(dir)) return [];
  const skills: InspectedAsset[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const skillDir = path.join(dir, name);
    if (!fs.statSync(skillDir).isDirectory()) continue;
    const skillMd = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillMd) || !fs.lstatSync(skillMd).isFile()) continue;
    let supporting = 0;
    let executable = false;
    const walk = (abs: string) => {
      for (const child of fs.readdirSync(abs, { withFileTypes: true })) {
        const full = path.join(abs, child.name);
        if (child.isDirectory()) walk(full);
        else if (child.isFile() && full !== skillMd) {
          supporting += 1;
          if ((fs.statSync(full).mode & 0o111) !== 0) executable = true;
        }
      }
    };
    walk(skillDir);
    skills.push({
      sourceDir: skillDir,
      bytesHash: hashSkillDir(skillDir),
      preview: {
        name,
        description: (descriptionFromFrontmatter(fs.readFileSync(skillMd, "utf8")) ?? "").slice(0, 200),
        path: path.posix.join(rel.replace(/\/$/, ""), name),
        status: "add",
        statusLabel: "Will add",
        supportingFiles: supporting,
        executable,
        conflictTargets: [],
      },
    });
  }
  return skills;
}

function listAgents(root: string, manifest: PluginManifest): InspectedAsset[] {
  const rel = manifest.contributes.agents;
  const dir = rel ? contained(root, rel) : null;
  if (!rel || !dir || !fs.existsSync(dir)) return [];
  const agents: InspectedAsset[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    // Same rule the catalog and general sync use: a direct child ending in .md.
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const file = path.join(dir, entry.name);
    const raw = fs.readFileSync(file, "utf8");
    const parsed = parseAgentMarkdown(raw);
    const frontmatter = parsed?.frontmatter ?? {};
    const summary = ["mode", "readonly"].filter((key) => frontmatter[key]).map((key) => `${key}: ${frontmatter[key]}`.slice(0, 80));
    agents.push({
      sourceFile: file,
      bytesHash: sha256(raw),
      preview: {
        name: entry.name.slice(0, -3),
        description: (descriptionFromFrontmatter(raw) ?? "").slice(0, 200),
        path: path.posix.join(rel.replace(/\/$/, ""), entry.name),
        status: "add",
        statusLabel: "Will add",
        readonly: frontmatter.readonly?.toLowerCase() === "true",
        frontmatter: summary,
        conflictTargets: [],
      },
    });
  }
  return agents;
}

function markProvidedElsewhere(
  assets: InspectedAsset[],
  core: Set<string> | undefined,
  others: Map<string, string> | undefined,
): void {
  for (const asset of assets) {
    const name = asset.preview.name;
    const owner = others?.get(name);
    if (core?.has(name)) {
      asset.preview.status = "core";
      asset.preview.statusLabel = "Already provided by core";
    } else if (owner) {
      asset.preview.status = "plugin";
      asset.preview.statusLabel = `Already provided by ${owner}`;
    }
  }
}

const EMPTY: Omit<InspectResult, "fatal" | "heading" | "body" | "issues" | "manifest" | "manifestHash"> = {
  treeHash: null,
  skills: [],
  agents: [],
  requirements: [],
  requirementsMet: true,
  unsupported: [],
  inventory: [],
  blockers: [],
  declaredIgnored: [],
};

function fatal(
  heading: string,
  body: string | null,
  issues: InspectIssue[],
  manifest: PluginManifest | null,
  manifestHash: string | null,
): InspectResult {
  return { ...EMPTY, fatal: true, heading, body, issues, manifest, manifestHash };
}

function fromManifestIssues(code: string, issues: ManifestIssue[]): InspectIssue[] {
  return issues.map((issue) => ({ code, file: "devhub-plugin.json", field: issue.field === "devhub-plugin.json" ? "" : issue.field, message: issue.message }));
}

export interface InspectOptions {
  coreSkills?: Set<string>;
  coreAgents?: Set<string>;
  otherSkills?: Map<string, string>;
  otherAgents?: Map<string, string>;
  env?: NodeJS.ProcessEnv;
}

/** Full review of a downloaded candidate. Folders registered by path never go through this. */
export function inspectPluginDir(root: string, opts: InspectOptions = {}): InspectResult {
  const treeIssues = walkPluginRoot(root);
  if (treeIssues.length) {
    const limited = treeIssues.some((issue) => issue.code === "LIMIT");
    return fatal(limited ? "This plugin is larger than DevHub will download for review." : "This plugin contains an unsafe file path", limited ? null : UNSAFE_MESSAGE, treeIssues, null, null);
  }
  const read = readManifestDetailed(root);
  if (!read.ok) {
    if (read.kind === "missing") {
      return fatal(
        "This repository doesn’t contain a DevHub plugin",
        "A plugin needs a devhub-plugin.json file at the repository root.",
        fromManifestIssues("MISSING_MANIFEST", read.issues),
        null,
        null,
      );
    }
    if (read.kind === "api") {
      return fatal(
        "This plugin needs a different DevHub plugin API",
        "This version of DevHub reads plugins that declare devhubApi \"1\".",
        fromManifestIssues("UNSUPPORTED_API", read.issues),
        null,
        null,
      );
    }
    return fatal("This repository isn’t a valid DevHub plugin", null, fromManifestIssues("INVALID_MANIFEST", read.issues), null, null);
  }

  const manifest = read.manifest;
  const manifestHash = hashFile(path.join(root, "devhub-plugin.json"));
  if (treeIssues.some((issue) => issue.code === "LIMIT")) {
    return fatal("This plugin is larger than DevHub will download for review.", null, treeIssues, manifest, manifestHash);
  }
  const issues = [...treeIssues];
  if (manifest.dashboard?.root && !contained(root, manifest.dashboard.root)) {
    issues.push({ code: "UNSAFE", file: "devhub-plugin.json", field: "dashboard.root", message: "points outside the plugin" });
  }
  for (const [kind, rel] of Object.entries(manifest.contributes)) {
    if (!rel) continue;
    const abs = contained(root, rel);
    if (!abs) issues.push({ code: "UNSAFE", file: "devhub-plugin.json", field: `contributes.${kind}`, message: "points outside the plugin" });
    else if (!fs.existsSync(abs)) issues.push({ code: "MISSING", file: "devhub-plugin.json", field: `contributes.${kind}`, message: `folder “${rel}” was not found` });
    else if (!fs.statSync(abs).isDirectory()) issues.push({ code: "UNSAFE", file: "devhub-plugin.json", field: `contributes.${kind}`, message: "must name a folder" });
  }
  if (issues.some((issue) => issue.code === "UNSAFE")) {
    return fatal("This plugin contains an unsafe file path", UNSAFE_MESSAGE, issues, manifest, manifestHash);
  }
  if (issues.length) return fatal("This repository isn’t a valid DevHub plugin", null, issues, manifest, manifestHash);

  const skills = listSkills(root, manifest);
  const agents = listAgents(root, manifest);
  markProvidedElsewhere(skills, opts.coreSkills, opts.otherSkills);
  markProvidedElsewhere(agents, opts.coreAgents, opts.otherAgents);

  const packages = mcpPackageNames(root);
  const unsupported: string[] = [];
  if (manifest.contributes.mcp || packages.length) unsupported.push("MCP servers");
  if (manifest.dashboard) unsupported.push("dashboard modules");
  if (manifest.dashboard?.overlays?.length) unsupported.push("overlays");
  if (manifest.branding) unsupported.push("branding");
  const declaredIgnored: string[] = [];
  if (manifest.contributes.docs) declaredIgnored.push("docs");
  if (manifest.contributes.personaModes) declaredIgnored.push("persona modes");

  const blockers: PreviewIssue[] = [];
  const unapplied = [...unsupported, ...declaredIgnored];
  if (unapplied.length) {
    blockers.push({
      code: "UNSUPPORTED",
      message: `It includes ${formatList(unapplied)}. You can inspect them below, but this version can only enable plugins containing skills and agents.`,
    });
  }
  for (const pkg of manifest.requires?.dashboardPackages ?? []) {
    blockers.push({
      code: "DASHBOARD_PACKAGE",
      message: `This plugin needs the dashboard package ${clip(pkg.package)}. Adding it requires a compatible app build.`,
    });
  }

  const requirements: RequirementPreview[] = (manifest.requires?.commands ?? []).map((command) => ({
    command: clip(command.command),
    available: commandOnPath(command.command, opts.env),
    installHint: command.install ? command.install.slice(0, 500) : null,
  }));

  return {
    ...EMPTY,
    fatal: false,
    heading: null,
    body: null,
    issues: [],
    manifest,
    skills,
    agents,
    requirements,
    requirementsMet: requirements.every((item) => item.available),
    unsupported,
    inventory: buildInventory(root, manifest, packages),
    blockers,
    declaredIgnored,
    manifestHash,
    treeHash: hashSkillDir(root),
  };
}

export function formatList(items: string[]): string {
  const unique = [...new Set(items)];
  if (unique.length <= 1) return unique[0] ?? "";
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

export function namesOnDisk(dir: string | null, kind: "skill" | "agent"): Set<string> {
  const names = new Set<string>();
  if (!dir || !fs.existsSync(dir)) return names;
  for (const name of fs.readdirSync(dir)) {
    if (kind === "agent") {
      if (name.endsWith(".md")) names.add(name.slice(0, -3));
    } else if (fs.existsSync(path.join(dir, name, "SKILL.md"))) names.add(name);
  }
  return names;
}

export type FolderProblem = "folder_missing" | "manifest_invalid";

export interface FolderSummary {
  problem: FolderProblem | null;
  manifest: PluginManifest | null;
  skills: number;
  agents: number;
}

/**
 * What a registered folder offers, without the admission checks a download
 * gets. Folders registered by path keep working exactly as they did, so this
 * reads the manifest and counts names and never walks the tree: a plugin with
 * its own node_modules is normal there.
 */
export function summarisePluginDir(dir: string): FolderSummary {
  if (!fs.existsSync(dir)) return { problem: "folder_missing", manifest: null, skills: 0, agents: 0 };
  const read = readManifestDetailed(dir);
  if (!read.ok) return { problem: "manifest_invalid", manifest: null, skills: 0, agents: 0 };
  const count = (rel: string | undefined, kind: "skill" | "agent") => {
    if (!rel) return 0;
    const abs = path.resolve(dir, rel);
    if (abs !== dir && !abs.startsWith(dir + path.sep)) return 0;
    return namesOnDisk(abs, kind).size;
  };
  return {
    problem: null,
    manifest: read.manifest,
    skills: count(read.manifest.contributes.skills, "skill"),
    agents: count(read.manifest.contributes.agents, "agent"),
  };
}
