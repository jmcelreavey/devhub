/**
 * Importing an existing Electron install.
 *
 * The promise made to an existing user is narrow and absolute: **install once,
 * lose nothing, and never have the app move your files without being asked.**
 * Every design decision below follows from that.
 *
 * - Nothing is deleted, ever. Migration copies or records; the Electron
 *   install is left completely intact so a failed migration costs nothing.
 * - Content paths default to *keeping data where it is*. Someone whose notes
 *   live in a private git mirror does not want them silently duplicated into
 *   an app-data folder that their git remote knows nothing about.
 * - Only recognised configuration keys are imported. An unknown line in
 *   `.env.local` could be anything; it goes to a review file rather than into
 *   the running environment.
 * - It is idempotent and records what it did, so running it twice is a no-op
 *   rather than a second copy.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DASHBOARD_MANAGED_ENV_KEY_SET } from "@/lib/dashboard-env-local";
import { getAppDataDir } from "@/lib/desktop/runtime-paths";

/** Bumped when the shape of `migration.json` changes incompatibly. */
export const MIGRATION_SCHEMA_VERSION = 1;

export interface LegacyPath {
  /** `NOTES_DIR`, `TASKS_DIR`, … or `REPO_ROOT`. */
  key: string;
  label: string;
  /** Where the data actually is today. */
  source: string;
  exists: boolean;
  /** Rough size indicator so the user can judge a copy. */
  entryCount: number;
  /**
   * Whether this path was set explicitly or merely defaulted.
   *
   * An implicit `REPO_ROOT/notes` is a coincidence of where the checkout sits;
   * an explicit `NOTES_DIR` is a decision the user already made. They deserve
   * different defaults.
   */
  explicit: boolean;
  /** Suggested action. The user can override every one of these. */
  suggested: "keep" | "copy";
}

export interface ElectronInstall {
  /** `~/Library/Application Support/DevHub` or the platform equivalent. */
  userDataDir: string;
  /** Checkout recorded in `repo-path.txt`, if it still exists. */
  checkout: string | null;
  /** `dashboard/.env.local` inside that checkout. */
  envFile: string | null;
  launcherSettings: string | null;
}

export interface MigrationPlan {
  install: ElectronInstall | null;
  paths: LegacyPath[];
  /** Managed keys found in the legacy env file, values withheld. */
  configKeys: string[];
  /** Lines that are not recognised managed keys. Never imported blind. */
  unknownLineCount: number;
  /** A previous migration already ran; this one would be a no-op. */
  alreadyMigrated: boolean;
}

export interface MigrationRecord {
  schemaVersion: number;
  migratedAt: string;
  appVersion: string;
  sourceUserData: string;
  sourceCheckout: string | null;
  /** What happened to each content path. */
  decisions: { key: string; action: "keep" | "copy" | "skip"; from: string; to?: string }[];
  importedKeys: string[];
  quarantinedLines: number;
}

/** Where Electron kept its user data, per platform. */
export function electronUserDataDirs(home: string = os.homedir()): string[] {
  if (process.platform === "darwin") {
    return [path.join(home, "Library", "Application Support", "DevHub")];
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    return [path.join(appData ?? path.join(home, "AppData", "Roaming"), "DevHub")];
  }
  return [path.join(home, ".config", "DevHub"), path.join(home, ".config", "devhub")];
}

function countEntries(dir: string): number {
  try {
    return fs.readdirSync(dir).filter((n) => !n.startsWith(".")).length;
  } catch {
    return 0;
  }
}

/** Parse an env file into managed keys and everything else. */
function readLegacyEnv(file: string): { managed: Map<string, string>; unknown: string[] } {
  const managed = new Map<string, string>();
  const unknown: string[] = [];
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return { managed, unknown };
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) {
      unknown.push(line);
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (DASHBOARD_MANAGED_ENV_KEY_SET.has(key)) managed.set(key, value);
    else unknown.push(line);
  }
  return { managed, unknown };
}

/**
 * Is this checkout one the user clearly owns and maintains?
 *
 * A checkout with a git remote is a mirror somebody pushes to — their notes
 * are *supposed* to live there, and copying them into app data would fork the
 * data silently, leaving edits in one place and their git history in another.
 * A checkout without a remote is more plausibly disposable, so copying is the
 * safer default there.
 *
 * The user overrides this either way; it only decides which checkbox starts
 * ticked.
 */
function looksLikeMaintainedCheckout(checkout: string): boolean {
  try {
    const config = fs.readFileSync(path.join(checkout, ".git", "config"), "utf-8");
    return /\[remote /.test(config);
  } catch {
    return false;
  }
}

/** Find an existing Electron install, if there is one. */
export function detectElectronInstall(home: string = os.homedir()): ElectronInstall | null {
  for (const dir of electronUserDataDirs(home)) {
    if (!fs.existsSync(dir)) continue;

    let checkout: string | null = null;
    const repoPathFile = path.join(dir, "repo-path.txt");
    try {
      const recorded = fs.readFileSync(repoPathFile, "utf-8").trim();
      if (recorded && fs.existsSync(recorded)) checkout = recorded;
    } catch {
      /* no recorded checkout */
    }

    const envFile = checkout ? path.join(checkout, "dashboard", ".env.local") : null;
    const launcherSettings = path.join(dir, "launcher-settings.json");

    return {
      userDataDir: dir,
      checkout,
      envFile: envFile && fs.existsSync(envFile) ? envFile : null,
      launcherSettings: fs.existsSync(launcherSettings) ? launcherSettings : null,
    };
  }
  return null;
}

const CONTENT_PATHS: { key: string; label: string; segment: string }[] = [
  { key: "NOTES_DIR", label: "Notes", segment: "notes" },
  { key: "TASKS_DIR", label: "Daily tasks", segment: "tasks" },
  { key: "COLLECTIONS_DIR", label: "Checklist collections", segment: "collections" },
  { key: "UPSTARTS_DIR", label: "Upstart scripts", segment: "upstarts" },
  { key: "DOCS_DIR", label: "Docs", segment: "docs" },
];

/**
 * Work out what a migration would do, without doing any of it.
 *
 * Separated from `runMigration` so the wizard can show the user real paths and
 * real sizes before anything is touched. "Trust me, I'll import your data" is
 * not a reasonable thing to ask of somebody about their own notes.
 */
export function planMigration(
  appDataDir: string = getAppDataDir(),
  home: string = os.homedir(),
): MigrationPlan {
  const install = detectElectronInstall(home);
  if (!install) {
    return {
      install: null,
      paths: [],
      configKeys: [],
      unknownLineCount: 0,
      alreadyMigrated: readMigrationRecord(appDataDir) !== null,
    };
  }

  const { managed, unknown } = install.envFile
    ? readLegacyEnv(install.envFile)
    : { managed: new Map<string, string>(), unknown: [] as string[] };

  const paths: LegacyPath[] = [];
  const maintained = install.checkout ? looksLikeMaintainedCheckout(install.checkout) : false;

  for (const { key, label, segment } of CONTENT_PATHS) {
    const explicitValue = managed.get(key)?.trim();
    // The implicit default is the one that bites: nothing records that notes
    // live at `<checkout>/notes`, it is simply where they ended up.
    const source = explicitValue || (install.checkout ? path.join(install.checkout, segment) : "");
    if (!source) continue;

    paths.push({
      key,
      label,
      source,
      exists: fs.existsSync(source),
      entryCount: countEntries(source),
      explicit: Boolean(explicitValue),
      // Keep-in-place for a maintained mirror; copy for a disposable checkout.
      suggested: maintained ? "keep" : "copy",
    });
  }

  const identitySource = install.checkout
    ? path.join(install.checkout, "persona", "identity.txt")
    : "";
  if (identitySource && fs.existsSync(identitySource)) {
    paths.push({
      key: "DEVHUB_IDENTITY_FILE",
      label: "Personal identity",
      source: identitySource,
      exists: true,
      entryCount: 1,
      explicit: false,
      // Always copy: the packaged identity is a generic placeholder, and a
      // personal one must never end up inside the replaceable app bundle.
      suggested: "copy",
    });
  }

  return {
    install,
    paths,
    configKeys: [...managed.keys()],
    unknownLineCount: unknown.length,
    alreadyMigrated: readMigrationRecord(appDataDir) !== null,
  };
}

export function migrationRecordPath(appDataDir: string = getAppDataDir()): string {
  return path.join(appDataDir, "migration.json");
}

export function readMigrationRecord(appDataDir: string = getAppDataDir()): MigrationRecord | null {
  try {
    const raw = fs.readFileSync(migrationRecordPath(appDataDir), "utf-8");
    const parsed = JSON.parse(raw) as MigrationRecord;
    return parsed.schemaVersion === MIGRATION_SCHEMA_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

/** Recursive copy that never overwrites. */
function copyPreservingExisting(from: string, to: string): number {
  let copied = 0;
  const stat = fs.statSync(from);
  if (stat.isFile()) {
    if (fs.existsSync(to)) return 0;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    return 1;
  }
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    copied += copyPreservingExisting(path.join(from, entry.name), path.join(to, entry.name));
  }
  return copied;
}

export interface MigrationChoice {
  key: string;
  action: "keep" | "copy" | "skip";
}

export interface MigrationResult {
  ok: boolean;
  record?: MigrationRecord;
  /** Env values to persist. Returned rather than written so the caller owns config. */
  envUpdates: Map<string, string>;
  quarantineFile?: string;
  error?: string;
  copied: Record<string, number>;
}

/**
 * Perform the migration the user approved.
 *
 * Returns the config to write rather than writing it, so there is exactly one
 * place in the codebase that owns `.env.local` and this is not a second one.
 */
export function runMigration(opts: {
  plan: MigrationPlan;
  choices: MigrationChoice[];
  appDataDir?: string;
  appVersion?: string;
}): MigrationResult {
  const appDataDir = opts.appDataDir ?? getAppDataDir();
  const { plan } = opts;
  const envUpdates = new Map<string, string>();
  const copied: Record<string, number> = {};

  if (!plan.install) {
    return { ok: false, error: "No existing DevHub installation found", envUpdates, copied };
  }

  const decisions: MigrationRecord["decisions"] = [];
  const byKey = new Map(opts.choices.map((c) => [c.key, c.action]));

  for (const legacy of plan.paths) {
    const action = byKey.get(legacy.key) ?? legacy.suggested;
    if (action === "skip" || !legacy.exists) {
      decisions.push({ key: legacy.key, action: "skip", from: legacy.source });
      continue;
    }

    if (action === "keep") {
      // Point the config at the existing location. Nothing moves, nothing is
      // duplicated, and the user's git mirror keeps working.
      envUpdates.set(legacy.key, legacy.source);
      decisions.push({ key: legacy.key, action: "keep", from: legacy.source });
      continue;
    }

    const destination =
      legacy.key === "DEVHUB_IDENTITY_FILE"
        ? path.join(appDataDir, "persona", "identity.txt")
        : path.join(appDataDir, path.basename(legacy.source));

    try {
      // Never overwrite: a second run, or a user who already wrote a note in
      // the new install, must not lose anything.
      copied[legacy.key] = copyPreservingExisting(legacy.source, destination);
    } catch (err) {
      return {
        ok: false,
        error: `Could not copy ${legacy.label}: ${err instanceof Error ? err.message : String(err)}`,
        envUpdates,
        copied,
      };
    }

    envUpdates.set(legacy.key, destination);
    decisions.push({ key: legacy.key, action: "copy", from: legacy.source, to: destination });
  }

  // Configuration: recognised keys only.
  let quarantineFile: string | undefined;
  const importedKeys: string[] = [];
  if (plan.install.envFile) {
    const { managed, unknown } = readLegacyEnv(plan.install.envFile);
    for (const [key, value] of managed) {
      // Path keys were decided above; importing the old value here would undo
      // a "copy" decision by pointing back at the original location.
      if (envUpdates.has(key)) continue;
      if (CONTENT_PATHS.some((p) => p.key === key)) continue;
      if (key === "REPO_ROOT") continue; // an installed app has no checkout
      if (!value) continue;
      envUpdates.set(key, value);
      importedKeys.push(key);
    }

    if (unknown.length > 0) {
      // Unknown lines are preserved for a human to read, not executed. An
      // arbitrary line in an env file is arbitrary code's worth of trust.
      quarantineFile = path.join(appDataDir, "config", "imported-unrecognised.env");
      fs.mkdirSync(path.dirname(quarantineFile), { recursive: true });
      fs.writeFileSync(
        quarantineFile,
        [
          "# Lines from your previous .env.local that DevHub does not recognise.",
          "# They were NOT imported. Review them, and copy anything you still need",
          "# into Settings or into config/.env.local by hand.",
          `# Source: ${plan.install.envFile}`,
          "",
          ...unknown,
          "",
        ].join("\n"),
        { mode: 0o600 },
      );
    }
  }

  // The code folder: the parent of the old checkout is where their repos were.
  if (plan.install.checkout && !envUpdates.has("DEVHUB_REPOS_DIR")) {
    envUpdates.set("DEVHUB_REPOS_DIR", path.dirname(plan.install.checkout));
  }

  const record: MigrationRecord = {
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    migratedAt: new Date().toISOString(),
    appVersion: opts.appVersion ?? "unknown",
    sourceUserData: plan.install.userDataDir,
    sourceCheckout: plan.install.checkout,
    decisions,
    importedKeys,
    quarantinedLines: plan.unknownLineCount,
  };

  fs.mkdirSync(appDataDir, { recursive: true });
  fs.writeFileSync(migrationRecordPath(appDataDir), `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });

  return { ok: true, record, envUpdates, quarantineFile, copied };
}
