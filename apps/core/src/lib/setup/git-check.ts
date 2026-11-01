import fs from "node:fs";
import { DEPENDENCIES, withInstallHints, type DependencySpec } from "./dependency-specs";
import { GitMissingError, whereToRun, type GitCheck } from "./git-error";
export { GitMissingError, missingGitCheck, type GitCheck } from "./git-error";
import { probeDependency } from "./dependencies";

/** Probe `git` on the machine the dashboard runs on: the WSL distro on Windows, the Mac on macOS. */
export async function checkGit(probe: typeof probeDependency = probeDependency): Promise<GitCheck> {
  const spec: DependencySpec = withInstallHints(DEPENDENCIES.find((tool) => tool.id === "git")!, {
    platform: process.platform,
    wsl: Boolean(process.env.WSL_DISTRO_NAME),
    apt: fs.existsSync("/usr/bin/apt-get"),
    homebrew: false,
  });
  const status = await probe(spec);
  return {
    present: status.present,
    version: status.version,
    where: whereToRun(),
    installCommand: status.installCommand ?? null,
    installUrl: status.installUrl ?? "https://git-scm.com/downloads",
  };
}

export async function assertGitAvailable(check?: GitCheck): Promise<void> {
  const result = check ?? await checkGit();
  if (!result.present) throw new GitMissingError(result);
}

/** The GitHub CLI DevHub bundles. Only needed to create, clone or verify a private repo. */
export class GhMissingError extends Error {
  constructor() {
    super("The GitHub CLI (`gh`) isn't available, and DevHub needs it to create or verify your private repo. Reinstall DevHub (it bundles gh), or install it from https://cli.github.com/. You can finish setup without it and connect a repo later.");
    this.name = "GhMissingError";
  }
}

export async function assertGhAvailable(probe: typeof probeDependency = probeDependency): Promise<void> {
  const spec = DEPENDENCIES.find((tool) => tool.id === "gh")!;
  if (!(await probe(spec)).present) throw new GhMissingError();
}
