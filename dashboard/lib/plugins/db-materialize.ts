/**
 * Materialise plugin database-connection providers into
 * `lib/plugin-db-providers.generated.ts`.
 *
 * The sibling of `nav-materialize.ts`, with one difference that matters: nav
 * contributions are *data* copied out of the manifest, while this generates
 * `import` statements pointing at plugin code. So it verifies the module is
 * actually there — a manifest naming a file that was never listed in
 * `dashboard.paths` produces an import of a file that does not exist, which
 * fails the whole build rather than one page.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { listEnabledPlugins } from "./registry";
import type { RegisteredPlugin } from "./types";

export const GEN_DB_PROVIDERS_REL = "lib/plugin-db-providers.generated.ts";

const EMPTY_DB_PROVIDERS_TS = `/* Empty baseline — rewritten by lib/plugins/db-materialize.ts when a plugin declares dashboard.connections.
 * Locally rewritten files use git update-index --skip-worktree so they never show as repo churn.
 */
import type { DbConnectionProvider } from "./db/provider";

export const PLUGIN_DB_PROVIDERS: DbConnectionProvider[] = [];
`;

/**
 * Hide local rewrites of the generated file from git status.
 *
 * Returns false when git refused — which happens for an *untracked* file, and
 * matters more here than it does for the nav materialiser. The nav file's
 * generated content is data; this one contains a real `import` of a
 * plugin-owned module that is git-ignored. Committing the generated version
 * would give anyone without that plugin an import of a file that does not
 * exist, and Next fails the whole build on it rather than one page.
 *
 * So the caller warns instead of failing silently: the fix is to commit the
 * empty baseline once, after which `--skip-worktree` works and the local
 * rewrite stays invisible.
 */
function setSkipWorktree(repoRoot: string, rel: string, skip: boolean): boolean {
  const result = spawnSync(
    "git",
    ["-C", repoRoot, "update-index", skip ? "--skip-worktree" : "--no-skip-worktree", `dashboard/${rel}`],
    { encoding: "utf-8" },
  );
  return result.status === 0;
}

export interface CollectedProvider {
  plugin: string;
  /** Dashboard-relative module path, e.g. "lib/bi-db-provider.ts". */
  modulePath: string;
  /** Import specifier used in the generated file, e.g. "./bi-db-provider". */
  specifier: string;
  /** Local binding, unique per plugin. */
  binding: string;
}

/** `lib/bi-db-provider.ts` → `./bi-db-provider`, relative to `lib/`. */
function toSpecifier(modulePath: string): string | null {
  const normalized = modulePath.replace(/\\/g, "/").replace(/\.tsx?$/, "");
  if (!normalized.startsWith("lib/")) return null;
  return `./${normalized.slice("lib/".length)}`;
}

function toBinding(pluginName: string): string {
  const camel = pluginName.replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase());
  return `${camel.replace(/[^a-zA-Z0-9]/g, "")}DbProvider`;
}

export function collectPluginDbProviders(plugins: RegisteredPlugin[]): {
  providers: CollectedProvider[];
  errors: string[];
} {
  const providers: CollectedProvider[] = [];
  const errors: string[] = [];

  for (const plugin of plugins) {
    const modulePath = plugin.manifest.dashboard?.connections;
    if (!modulePath) continue;

    const root = plugin.manifest.dashboard?.root;
    if (!root) {
      errors.push(`[${plugin.name}] dashboard.connections needs dashboard.root`);
      continue;
    }

    const specifier = toSpecifier(modulePath);
    if (!specifier) {
      // The generated file lives in `lib/`, so anything outside it cannot be
      // imported with a stable relative path.
      errors.push(`[${plugin.name}] dashboard.connections must be under lib/, got: ${modulePath}`);
      continue;
    }

    // The generated import must resolve, so the module has to be materialised —
    // which means it has to be listed in dashboard.paths. Catching that here
    // turns a whole-build failure into one legible line.
    const declared = plugin.manifest.dashboard?.paths ?? [];
    const covered = declared.some(
      (p) => p === modulePath || modulePath.startsWith(p.endsWith("/") ? p : `${p}/`),
    );
    if (!covered) {
      errors.push(
        `[${plugin.name}] dashboard.connections (${modulePath}) is not covered by dashboard.paths — it would never be materialised`,
      );
      continue;
    }

    const source = path.join(plugin.path, root, modulePath);
    if (!fs.existsSync(source)) {
      errors.push(`[${plugin.name}] dashboard.connections file not found: ${source}`);
      continue;
    }

    providers.push({ plugin: plugin.name, modulePath, specifier, binding: toBinding(plugin.name) });
  }

  return { providers, errors };
}

export function buildGeneratedDbProvidersTs(providers: CollectedProvider[]): string {
  if (providers.length === 0) return EMPTY_DB_PROVIDERS_TS;

  const names = providers.map((p) => p.plugin).join(", ");
  const imports = providers
    .map((p) => `import ${p.binding} from ${JSON.stringify(p.specifier)};`)
    .join("\n");
  const entries = providers.map((p) => `  ${p.binding},`).join("\n");

  return `/* GENERATED from plugin connections (${names}) — do not edit (see lib/plugins/db-materialize.ts). */
import type { DbConnectionProvider } from "./db/provider";
${imports}

export const PLUGIN_DB_PROVIDERS: DbConnectionProvider[] = [
${entries}
];
`;
}

export interface DbMaterializeOptions {
  repoRoot: string;
  emit: (line: string) => void;
  dryRun?: boolean;
  home?: string;
}

/** Write plugin-db-providers.generated.ts from enabled plugin manifests. Returns 0 / 1. */
export function materializePluginDbProviders(opts: DbMaterializeOptions): number {
  const { repoRoot, emit, dryRun } = opts;
  const genPath = path.join(repoRoot, "dashboard", GEN_DB_PROVIDERS_REL);
  const plugins = listEnabledPlugins(opts.home, emit);
  const { providers, errors } = collectPluginDbProviders(plugins);

  for (const e of errors) emit(`db-providers: ${e}`);
  if (errors.length) return 1;

  const body = buildGeneratedDbProvidersTs(providers);

  if (dryRun) {
    emit(
      providers.length === 0
        ? "db-providers: no plugin declares dashboard.connections (would restore empty baseline)"
        : `db-providers: would materialise ${providers.length} provider(s) from ${providers.map((p) => p.plugin).join(", ")}`,
    );
    return 0;
  }

  fs.mkdirSync(path.dirname(genPath), { recursive: true });
  fs.writeFileSync(genPath, body);
  const hidden = setSkipWorktree(repoRoot, GEN_DB_PROVIDERS_REL, providers.length > 0);

  emit(
    providers.length === 0
      ? "db-providers: none active (baseline restored)"
      : `db-providers: materialised ${providers.length} provider(s) from ${providers.map((p) => p.plugin).join(", ")}`,
  );

  if (providers.length > 0 && !hidden) {
    emit(
      `WARNING: ${GEN_DB_PROVIDERS_REL} is untracked, so this rewrite is visible to git. ` +
        `Commit the empty baseline once (git stash the plugin import first) — committing the ` +
        `generated version would give anyone without the plugin an import of an ignored file, ` +
        `which fails the build.`,
    );
  }

  return 0;
}
