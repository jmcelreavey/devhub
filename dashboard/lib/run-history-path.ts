import os from "node:os";
import path from "node:path";
import { defaultAppDataDir } from "@/lib/desktop/runtime-paths";
import { profileStateDir, stateProfileId } from "@/lib/profile-state";

/**
 * The script run audit log for this DevHub profile. Two kinds of "profile" get
 * their own file: a desktop app the shell scoped with DEVHUB_STATE_PROFILE
 * (every Windows profile shares one WSL app data, so the shell has to say), and
 * a desktop app running on non-default app data, whose history lives under that
 * app data. devhub.service, `npm run dev` and the default desktop profile keep
 * the machine-wide file.
 *
 * DEVHUB_PROFILE is deliberately ignored: it picks the task profile
 * (tasks/<profile>/), and machines that set it would otherwise lose sight of
 * their existing history. XDG_STATE_HOME is ignored for the same reason; the
 * writer has always used ~/.local/state.
 */
export function runHistoryFile(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const home = env.HOME?.trim() || os.homedir();
  if (stateProfileId(env)) return path.join(profileStateDir(env, home), "runs.jsonl");
  const appData = env.DEVHUB_APP_DATA?.trim();
  if (env.DEVHUB_DESKTOP === "1" && appData && path.resolve(appData) !== defaultAppDataDir(home, env)) {
    return path.join(path.resolve(appData), "logs", "runs.jsonl");
  }
  // Keep the live audit trail in place, including old scratch runs: without a
  // recorded profile on those entries, migrating them would risk losing history.
  return path.join(home, ".local", "state", "devhub", "runs.jsonl");
}
