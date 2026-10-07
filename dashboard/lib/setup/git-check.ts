import fs from "node:fs";
import { DEPENDENCIES, probeDependency, withInstallHints, type DependencySpec } from "@/lib/setup/dependencies";

export interface GitCheck {
  present: boolean;
  version: string | null;
  /** Where the command has to run: "Ubuntu (WSL)", "Terminal", … */
  where: string;
  /** Copyable install command for this machine, when there is a sensible one. */
  installCommand: string | null;
  installUrl: string;
}

/** Shown wherever Git is needed and missing, so nothing fails later with `spawn git ENOENT`. */
export class GitMissingError extends Error {
  constructor(readonly check: GitCheck) {
    super(
      check.installCommand
        ? `Git isn't installed (${check.where}). Run \`${check.installCommand}\`, then try again.`
        : `Git isn't installed. Install it from ${check.installUrl}, then try again.`,
    );
    this.name = "GitMissingError";
  }
}

function whereToRun(): string {
  if (process.env.WSL_DISTRO_NAME) return `${process.env.WSL_DISTRO_NAME} (WSL terminal)`;
  return process.platform === "darwin" ? "Terminal" : "a terminal";
}

/** Probe `git` on the machine the dashboard runs on: the WSL distro on Windows, the Mac on macOS. */
export function checkGit(probe: typeof probeDependency = probeDependency): GitCheck {
  const spec: DependencySpec = withInstallHints(DEPENDENCIES.find((tool) => tool.id === "git")!, {
    platform: process.platform,
    wsl: Boolean(process.env.WSL_DISTRO_NAME),
    apt: fs.existsSync("/usr/bin/apt-get"),
    homebrew: false,
  });
  const status = probe(spec);
  return {
    present: status.present,
    version: status.version,
    where: whereToRun(),
    installCommand: status.installCommand ?? null,
    installUrl: status.installUrl ?? "https://git-scm.com/downloads",
  };
}

export function assertGitAvailable(check: GitCheck = checkGit()): void {
  if (!check.present) throw new GitMissingError(check);
}

/** The GitHub CLI DevHub bundles. Only needed to create, clone or verify a private repo. */
export class GhMissingError extends Error {
  constructor() {
    super("The GitHub CLI (`gh`) isn't available, and DevHub needs it to create or verify your private repo. Reinstall DevHub (it bundles gh), or install it from https://cli.github.com/. You can finish setup without it and connect a repo later.");
    this.name = "GhMissingError";
  }
}

export function assertGhAvailable(probe: typeof probeDependency = probeDependency): void {
  const spec = DEPENDENCIES.find((tool) => tool.id === "gh")!;
  if (!probe(spec).present) throw new GhMissingError();
}
