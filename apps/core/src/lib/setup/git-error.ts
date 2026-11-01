import { DEPENDENCIES, withInstallHints, type DependencySpec } from "./dependency-specs";

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

export function whereToRun(): string {
  if (process.env.WSL_DISTRO_NAME) return `${process.env.WSL_DISTRO_NAME} (WSL terminal)`;
  return process.platform === "darwin" ? "Terminal" : "a terminal";
}

/** Install instructions without probing. Used when the CLT shim must not be executed. */
export function missingGitCheck(): GitCheck {
  const spec: DependencySpec = withInstallHints(DEPENDENCIES.find((tool) => tool.id === "git")!, {
    platform: process.platform,
    wsl: Boolean(process.env.WSL_DISTRO_NAME),
    apt: false,
    homebrew: false,
  });
  return {
    present: false,
    version: null,
    where: whereToRun(),
    installCommand: spec.installCommand ?? null,
    installUrl: spec.installUrl ?? "https://git-scm.com/downloads",
  };
}

