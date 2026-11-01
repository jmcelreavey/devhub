import path from "node:path";
import { readAppVersion } from "../desktop/app-version";
import { execExternal } from "../exec-external";
import { assessGitAvailability } from "../setup/git-availability";

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

export async function versionExit(file: string, env: NodeJS.ProcessEnv): Promise<number> {
  const childEnv = { ...process.env, ...env };
  try {
    await execExternal(file, ["--version"], { env: childEnv, timeoutMs: 4_000, label: `${path.basename(file)}:--version` });
    return 0;
  } catch (error) {
    const code = (error as { code?: string | number }).code;
    return typeof code === "number" ? code : 1;
  }
}

/** git is only probed after the Command Line Tools shim check. gh must actually run. */
export async function diagnosticToolFlags(env: NodeJS.ProcessEnv): Promise<{
  gitAvailable: boolean;
  ghAvailable: boolean;
  appVersion: string;
}> {
  const [gate, ghExit] = await Promise.all([
    await assessGitAvailability({ env, augment: true }),
    versionExit("gh", env),
  ]);
  const gitExit = gate.runnable && gate.bin
    ? await versionExit(gate.bin, { ...env, PATH: [path.dirname(gate.bin), env.PATH ?? process.env.PATH].filter(Boolean).join(path.delimiter) })
    : null;
  return flagsFromExits({ gitExit, ghExit, appVersion: readAppVersion(env) });
}
