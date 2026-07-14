/**
 * Materialise plugin nav contributions into `lib/plugin-nav.generated.ts`.
 *
 * Plugins declare `dashboard.nav` entries in `devhub-plugin.json`. Core merges them
 * into ALL_NAV_DESTINATIONS / SECTION_TABS so /ops-style pages don't need hand stubs
 * in `lib/nav.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { listEnabledPlugins } from "./registry";
import type { PluginNavItem, RegisteredPlugin } from "./types";

export const GEN_NAV_REL = "lib/plugin-nav.generated.ts";

const EMPTY_NAV_TS = `/* Empty baseline — rewritten by lib/plugins/nav-materialize.ts when a plugin declares dashboard.nav.
 * Locally rewritten files use git update-index --skip-worktree so they never show as repo churn.
 */
import type { NavItem, SectionTab } from "./nav";

export const PLUGIN_NAV_ITEMS: NavItem[] = [];

export const PLUGIN_SECTION_TABS: Partial<Record<"library" | "system", SectionTab[]>> = {};
`;

function setSkipWorktree(repoRoot: string, rel: string, skip: boolean): void {
  spawnSync(
    "git",
    ["-C", repoRoot, "update-index", skip ? "--skip-worktree" : "--no-skip-worktree", `dashboard/${rel}`],
    { encoding: "utf-8" },
  );
}

function escapeStr(s: string): string {
  return JSON.stringify(s);
}

function renderNavItem(item: PluginNavItem): string {
  const parts = [
    `href: ${escapeStr(item.href)}`,
    `label: ${escapeStr(item.label)}`,
    `icon: ${escapeStr(item.icon)}`,
    `group: ${escapeStr(item.group)}`,
  ];
  if (item.gate) parts.push(`gate: ${escapeStr(item.gate)}`);
  if (item.desktopOnly) parts.push(`desktopOnly: true`);
  if (item.shortcut) parts.push(`shortcut: ${escapeStr(item.shortcut)}`);
  return `  { ${parts.join(", ")} }`;
}

function renderSectionTab(item: PluginNavItem): string {
  const parts = [`href: ${escapeStr(item.href)}`, `label: ${escapeStr(item.label)}`];
  if (item.gate) parts.push(`gate: ${escapeStr(item.gate)}`);
  if (item.desktopOnly) parts.push(`desktopOnly: true`);
  return `    { ${parts.join(", ")} }`;
}

/** Collect nav entries from enabled plugins (first plugin wins on href collision). */
export function collectPluginNav(plugins: RegisteredPlugin[]): {
  items: PluginNavItem[];
  errors: string[];
} {
  const items: PluginNavItem[] = [];
  const errors: string[] = [];
  const claimed = new Set<string>();

  for (const plugin of plugins) {
    const nav = plugin.manifest.dashboard?.nav;
    if (!nav?.length) continue;
    const defaultGate = plugin.manifest.navGate;
    for (const raw of nav) {
      const item: PluginNavItem = {
        ...raw,
        gate: raw.gate ?? defaultGate,
      };
      if (claimed.has(item.href)) {
        errors.push(`[${plugin.name}] nav href already claimed: ${item.href}`);
        continue;
      }
      claimed.add(item.href);
      items.push(item);
    }
  }

  return { items, errors };
}

function buildGeneratedTs(items: PluginNavItem[], pluginNames: string[]): string {
  if (items.length === 0) return EMPTY_NAV_TS;

  const sectionTabs: Record<"library" | "system", PluginNavItem[]> = {
    library: [],
    system: [],
  };
  for (const item of items) {
    if (item.section === "library" || item.section === "system") {
      sectionTabs[item.section].push(item);
    }
  }

  const sectionBlocks: string[] = [];
  for (const key of ["library", "system"] as const) {
    if (sectionTabs[key].length === 0) continue;
    sectionBlocks.push(
      `  ${key}: [\n${sectionTabs[key].map(renderSectionTab).join(",\n")},\n  ]`,
    );
  }

  const names = pluginNames.length ? pluginNames.join(", ") : "plugins";
  return `/* GENERATED from plugin nav (${names}) — do not edit (see lib/plugins/nav-materialize.ts). */
import type { NavItem, SectionTab } from "./nav";

export const PLUGIN_NAV_ITEMS: NavItem[] = [
${items.map(renderNavItem).join(",\n")},
];

export const PLUGIN_SECTION_TABS: Partial<Record<"library" | "system", SectionTab[]>> = {
${sectionBlocks.join(",\n")}
};
`;
}

export interface NavMaterializeOptions {
  repoRoot: string;
  emit: (line: string) => void;
  dryRun?: boolean;
  home?: string;
}

/** Write plugin-nav.generated.ts from enabled plugin manifests. Returns 0 / 1. */
export function materializePluginNav(opts: NavMaterializeOptions): number {
  const { repoRoot, emit, dryRun } = opts;
  const genPath = path.join(repoRoot, "dashboard", GEN_NAV_REL);
  const plugins = listEnabledPlugins(opts.home, emit);
  const { items, errors } = collectPluginNav(plugins);

  for (const e of errors) emit(`nav: ${e}`);
  if (errors.length) return 1;

  const pluginNames = plugins
    .filter((p) => (p.manifest.dashboard?.nav?.length ?? 0) > 0)
    .map((p) => p.name);
  const body = buildGeneratedTs(items, pluginNames);

  if (dryRun) {
    emit(
      items.length === 0
        ? "nav: no plugin declares dashboard.nav (would restore empty baseline)"
        : `nav: would materialise ${items.length} item(s) from ${pluginNames.join(", ")}`,
    );
    return 0;
  }

  fs.mkdirSync(path.dirname(genPath), { recursive: true });
  fs.writeFileSync(genPath, body);
  setSkipWorktree(repoRoot, GEN_NAV_REL, items.length > 0);

  if (items.length === 0) {
    emit("nav: none active (baseline restored)");
  } else {
    emit(`nav: materialised ${items.length} item(s) from ${pluginNames.join(", ")}`);
  }
  return 0;
}
