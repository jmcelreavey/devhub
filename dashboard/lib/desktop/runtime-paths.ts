/**
 * The runtime path contract.
 *
 * DevHub has three genuinely different root directories, and until now two of
 * them were the same variable. `REPO_ROOT` meant "the git checkout", "where
 * generic assets live", "where your notes live", and "the folder above your
 * other repos" simultaneously. That works exactly as long as the app *is* a
 * checkout. An installed desktop app is not one, and pretending otherwise is
 * how an auto-update ends up overwriting somebody's notes.
 *
 * So they are split:
 *
 * - **Resource root** (`DEVHUB_RESOURCE_ROOT`) — read-only packaged assets:
 *   skills, agents, MCP definitions, the default persona, seed docs. Replaced
 *   wholesale by every update. Never written to.
 * - **App data** (`DEVHUB_APP_DATA`) — writable user state: config, notes,
 *   tasks, collections, upstarts, docs, identity, logs. Never touched by an
 *   update.
 * - **Checkout** (`REPO_ROOT`) — an *optional* real git checkout. Sync, ship,
 *   plugin materialisation, and git status genuinely need one; everything else
 *   must not assume it exists.
 * - **Repos dir** (`DEVHUB_REPOS_DIR`) — the user's code folder. Previously
 *   inferred as the parent of the checkout, which is a coincidence of one
 *   person's directory layout, not a contract.
 *
 * In checkout mode every one of these falls back to the old behaviour, so
 * `npm run dev` is unchanged.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** True when running inside the packaged desktop app rather than a checkout. */
export function isDesktopRuntime(): boolean {
  return process.env.DEVHUB_DESKTOP === "1";
}

function trimmedEnv(key: string): string | undefined {
  const raw = process.env[key];
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  return value ? value : undefined;
}

/**
 * The checkout this file lives in, by walking up from `dashboard/lib/desktop/`.
 *
 * Depth is load-bearing and nothing typechecks it: `dashboard/lib/desktop/` →
 * `../../..` → repo root. If this file moves, count the levels by hand. The
 * same trap already bit `lib/content/dirs.ts` once — see the comment there.
 */
function inferredCheckoutRoot(): string {
  return path.resolve(__dirname, "../../..");
}

/**
 * Read-only packaged asset root.
 *
 * Installed: the Tauri resource directory. Development: the checkout, because
 * that is where `skills/`, `agents/`, `mcp/` and `persona/` actually live.
 */
export function getResourceRoot(): string {
  const explicit = trimmedEnv("DEVHUB_RESOURCE_ROOT");
  if (explicit) return path.resolve(explicit);
  return trimmedEnv("REPO_ROOT") ? path.resolve(trimmedEnv("REPO_ROOT")!) : inferredCheckoutRoot();
}

/**
 * Checkout path recorded by the desktop shell (`repo-path.txt` under app data).
 *
 * Attach / first-run write this so packaged mode can still run checkout-only
 * actions such as sync without baking `REPO_ROOT` into the sidecar env.
 */
function linkedCheckoutFromAppData(): string | null {
  try {
    const file = path.join(getAppDataDir(), "repo-path.txt");
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return null;
    return path.resolve(expandHome(raw));
  } catch {
    return null;
  }
}

/**
 * The optional real git checkout, or `null`.
 *
 * "Real" means it has a `.git` entry. This check is the whole point: without
 * it, an installed app with `REPO_ROOT` pointed at its own bundle would happily
 * run `git status` against the application and report nonsense — or worse, a
 * sync would try to write into the read-only resource tree.
 *
 * Resolution order:
 * 1. `REPO_ROOT` env (explicit)
 * 2. Desktop `repo-path.txt` under app data (linked checkout)
 * 3. Inferred from this file's location (checkout / `npm run dev` only)
 *
 * Callers that need a checkout should branch on `null` and hide the action,
 * not throw. "Sync is unavailable because there is no checkout" is a legitimate
 * state for an installed app, not an error.
 */
export function getCheckoutRoot(): string | null {
  const explicit = trimmedEnv("REPO_ROOT");
  const candidate = explicit
    ? path.resolve(explicit)
    : isDesktopRuntime()
      ? linkedCheckoutFromAppData()
      : inferredCheckoutRoot();
  if (!candidate) return null;
  try {
    if (!fs.existsSync(path.join(candidate, ".git"))) return null;
  } catch {
    return null;
  }
  return candidate;
}

/** True when checkout-only features (sync, ship, plugins, git status) can run. */
export function hasCheckout(): boolean {
  return getCheckoutRoot() !== null;
}

/**
 * Writable application-data root.
 *
 * Installed: passed in by the Rust shell, which uses the OS convention
 * (`~/Library/Application Support/DevHub` on macOS, `$XDG_DATA_HOME/devhub` on
 * Linux). Development: the checkout, so `npm run dev` keeps writing notes and
 * tasks exactly where it always has.
 */
export function getAppDataDir(): string {
  const explicit = trimmedEnv("DEVHUB_APP_DATA");
  if (explicit) return path.resolve(explicit);
  if (!isDesktopRuntime()) {
    const checkout = trimmedEnv("REPO_ROOT");
    return checkout ? path.resolve(checkout) : inferredCheckoutRoot();
  }
  return defaultAppDataDir();
}

/** OS-conventional app data location. Exported so the Rust shell and tests agree. */
export function defaultAppDataDir(home: string = os.homedir()): string {
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "DevHub");
  }
  if (process.platform === "win32") {
    const appData = trimmedEnv("APPDATA");
    return path.join(appData ? path.resolve(appData) : path.join(home, "AppData", "Roaming"), "DevHub");
  }
  const xdg = trimmedEnv("XDG_DATA_HOME");
  return path.join(xdg ? path.resolve(xdg) : path.join(home, ".local", "share"), "devhub");
}

/** `<app-data>/config/.env.local` installed; `dashboard/.env.local` in a checkout. */
export function getEnvFilePath(): string {
  const explicit = trimmedEnv("DEVHUB_ENV_FILE");
  if (explicit) return path.resolve(explicit);
  if (isDesktopRuntime()) return path.join(getAppDataDir(), "config", ".env.local");
  return path.resolve(process.cwd(), ".env.local");
}

/**
 * The user's code folder.
 *
 * The old behaviour — parent of the checkout — survives as the development
 * fallback only. It was never a contract; it was true because this developer
 * keeps `~/Developer/devhub` next to `~/Developer/other-repo`. An installed
 * app has no checkout to take the parent of, and taking the parent of
 * `/Applications` would be actively wrong.
 */
export function getReposDir(): string {
  const explicit = trimmedEnv("DEVHUB_REPOS_DIR");
  if (explicit) return path.resolve(expandHome(explicit));
  const checkout = getCheckoutRoot();
  if (checkout) return path.dirname(checkout);
  return path.join(os.homedir(), "Developer");
}

/** Writable identity file, falling back to the packaged generic persona. */
export function getIdentityFilePath(): string {
  const explicit = trimmedEnv("DEVHUB_IDENTITY_FILE");
  if (explicit) return path.resolve(explicit);
  if (isDesktopRuntime()) return path.join(getAppDataDir(), "persona", "identity.txt");
  return path.join(getResourceRoot(), "persona", "identity.txt");
}

/** The packaged generic identity used when the writable one does not exist yet. */
export function getPackagedIdentityFilePath(): string {
  return path.join(getResourceRoot(), "persona", "identity.txt");
}

/** `~` and `~/x` expansion. Setup accepts typed paths, and people type tildes. */
export function expandHome(p: string, home: string = os.homedir()): string {
  if (!p) return p;
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

/** The writable directories first launch must create before anything writes. */
export const APP_DATA_SUBDIRS = [
  "config",
  "notes",
  "tasks",
  "collections",
  "upstarts",
  "docs",
  "persona",
  "logs",
] as const;

/**
 * Create the writable tree.
 *
 * `0700` throughout: `config/.env.local` holds API tokens and `logs/` holds
 * verbatim terminal transcripts. On a shared machine neither should be
 * readable by another account, and the app-data root is the only place to
 * enforce that once.
 */
export function ensureAppDataTree(appDataDir: string = getAppDataDir()): string {
  fs.mkdirSync(appDataDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(appDataDir, 0o700); // mkdir's mode is ignored if it already exists
  } catch {
    /* non-POSIX filesystem — permissions are best-effort */
  }
  for (const sub of APP_DATA_SUBDIRS) {
    const dir = path.join(appDataDir, sub);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return appDataDir;
}

/**
 * The environment an installed sidecar should run with.
 *
 * Built in one place so the Rust shell, the self-test, and the supervisor
 * cannot drift apart — three implementations of "which directory is NOTES_DIR"
 * is exactly how personal data ends up in the app bundle.
 *
 * Existing values win. A user who has already migrated and points `NOTES_DIR`
 * at their old checkout must keep pointing there; this fills gaps, it does not
 * relocate anybody.
 */
export function desktopEnvDefaults(opts: {
  appDataDir: string;
  resourceRoot: string;
  reposDir?: string;
  existing?: Readonly<Record<string, string | undefined>>;
}): Record<string, string> {
  const { appDataDir, resourceRoot, reposDir } = opts;
  const existing: Readonly<Record<string, string | undefined>> = opts.existing ?? {};
  const defaults: Record<string, string> = {
    DEVHUB_DESKTOP: "1",
    DEVHUB_APP_DATA: appDataDir,
    DEVHUB_RESOURCE_ROOT: resourceRoot,
    DEVHUB_ENV_FILE: path.join(appDataDir, "config", ".env.local"),
    NOTES_DIR: path.join(appDataDir, "notes"),
    TASKS_DIR: path.join(appDataDir, "tasks"),
    COLLECTIONS_DIR: path.join(appDataDir, "collections"),
    UPSTARTS_DIR: path.join(appDataDir, "upstarts"),
    DOCS_DIR: path.join(appDataDir, "docs"),
    DEVHUB_IDENTITY_FILE: path.join(appDataDir, "persona", "identity.txt"),
  };
  if (reposDir) defaults.DEVHUB_REPOS_DIR = reposDir;

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(defaults)) {
    const current = existing[key]?.trim();
    out[key] = current ? current : value;
  }
  return out;
}
