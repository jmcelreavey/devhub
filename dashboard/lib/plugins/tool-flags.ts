import { execFileSync } from "node:child_process";
import { readAppVersion } from "@/lib/desktop/app-version";
import { assessGitAvailabilitySync } from "@/lib/setup/git-availability";

export function flagsFromExits(input: { gitExit: number | null; ghExit: number | null; appVersion: string }): {
  gitAvailable: boolean;
  ghAvailable: boolean;
  appVersion: string;
} {
  const appVersion = input.appVersion.trim();
  return {
    gitAvailable: input.gitExit === 0,
    ghAvailable: input.ghExit === 0,
    appVersion: appVersion || "unknown",
  };
}

/** Exit code of `--version`, or null when the command was not run. */
export function versionExit(file: string, env: NodeJS.ProcessEnv): number | null {
  // Keep HOME. A probe env that only sets PATH would make gh write state into the repo.
  const childEnv = { ...process.env, ...env };
  try {
    execFileSync(file, ["--version"], {
      env: childEnv,
      timeout: 4_000,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return 0;
  } catch (error) {
    const status = (error as { status?: number }).status;
    return typeof status === "number" ? status : 1;
  }
}

/** git is only probed after the Command Line Tools shim check. gh must actually run. */
export function diagnosticToolFlags(env: NodeJS.ProcessEnv): {
  gitAvailable: boolean;
  ghAvailable: boolean;
  appVersion: string;
} {
  const gate = assessGitAvailabilitySync({ env, augment: true });
  const gitExit = gate.runnable && gate.bin ? versionExit(gate.bin, env) : null;
  return flagsFromExits({
    gitExit,
    ghExit: versionExit("gh", env),
    appVersion: readAppVersion(env),
  });
}
