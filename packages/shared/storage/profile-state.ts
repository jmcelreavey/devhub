import os from "node:os";
import path from "node:path";

type Env = Readonly<Record<string, string | undefined>>;

export function defaultAppDataDir(home: string = os.homedir(), env: Env = process.env): string {
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "DevHub");
  }
  if (process.platform === "win32") {
    const appData = env.APPDATA?.trim();
    return path.join(appData ? path.resolve(appData) : path.join(home, "AppData", "Roaming"), "DevHub");
  }
  const xdg = env.XDG_DATA_HOME?.trim();
  return path.join(xdg ? path.resolve(xdg) : path.join(home, ".local", "share"), "devhub");
}

/**
 * The Windows shell's id for an app instance that must not share the live
 * DevHub's run history, run logs or dashboard record.
 *
 * Inside WSL every Windows profile has the same app data
 * (`~/.local/share/devhub`), so nothing on this side can tell a scratch profile
 * from the main one. The shell decides (desktop/src-tauri `wsl::state_scope`)
 * and passes `DEVHUB_STATE_PROFILE` only for a profile that must stay apart.
 *
 * Only a desktop app honours it, and only a well-formed id: anything else falls
 * back to the live paths, because hiding the user's real history is worse than
 * a scratch profile writing to it. DEVHUB_PROFILE (the task profile) and
 * XDG_STATE_HOME deliberately move nothing; see run-history-path.ts.
 */
const STATE_PROFILE_ID = /^[a-f0-9]{16,64}$/;

export function stateProfileId(env: Env = process.env): string | null {
  if (env.DEVHUB_DESKTOP !== "1") return null;
  const id = env.DEVHUB_STATE_PROFILE?.trim();
  return id && STATE_PROFILE_ID.test(id) ? id : null;
}

function homeOf(env: Env): string {
  return env.HOME?.trim() || os.homedir();
}

/** Checkout dev's state root, selected by the startup defaults. */
export function checkoutStateDir(env: Env = process.env): string | null {
  const appData = env.DEVHUB_APP_DATA?.trim();
  return env.DEVHUB_CHECKOUT_DEV === "1" && appData
    ? path.resolve(appData, ".devhub", "state")
    : null;
}

/** `~/.local/state/devhub`, or its `profiles/<id>` subdirectory for a scoped profile. */
export function profileStateDir(env: Env = process.env, home: string = homeOf(env)): string {
  const live = path.join(home, ".local", "state", "devhub");
  const id = stateProfileId(env);
  return id ? path.join(live, "profiles", id) : live;
}

/** Where run logs (`<runId>.json`) are written and read. */
export function runLogsDir(env: Env = process.env, home: string = homeOf(env)): string {
  return path.join(checkoutStateDir(env) ?? profileStateDir(env, home), "run-logs");
}

/** `~/.config/devhub`, or its `profiles/<id>` subdirectory for a scoped profile. */
export function profileConfigDir(env: Env = process.env, home: string = homeOf(env)): string {
  const live = path.join(home, ".config", "devhub");
  const id = stateProfileId(env);
  return id ? path.join(live, "profiles", id) : live;
}
