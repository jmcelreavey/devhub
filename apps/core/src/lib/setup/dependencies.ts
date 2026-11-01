/**
 * External tool detection for onboarding.
 *
 * DevHub orchestrates command-line tools, and until now it *assumed* they were
 * there. When one wasn't, you got a failed subprocess and a stack trace in a run
 * log — which tells an experienced developer what to install and tells everyone
 * else that the app is broken.
 *
 * The important distinction this introduces is **required vs optional**, which
 * did not exist anywhere before. `git` is genuinely required. `gh`, Docker and
 * the cloud CLIs gate *specific features* and should degrade quietly rather than
 * break the app. Presenting all eight as equally missing is what turns a setup
 * screen into a wall of red that a new user reads as failure.
 */
import { DEPENDENCIES, withInstallHints, type DependencySpec, type DependencyStatus, type InstallContext } from "./dependency-specs";
export { DEPENDENCIES, withInstallHints, type DependencyId, type DependencySpec, type DependencyStatus } from "./dependency-specs";
import os from "node:os";
import fs from "node:fs";
import { execExternal } from "../exec-external";
import { findInstalledApp } from "../launch/desktop";
import path from "node:path";
import { assessGitAvailability } from "./git-availability";

/**
 * Directories to add to PATH before probing.
 *
 * A GUI-launched or service-launched Node process does not inherit the PATH
 * from your shell profile, so tools installed to a user-local bin are invisible
 * to it. This was not theoretical: `claude` is installed at `~/.local/bin` on
 * this machine and the first version of this probe reported it missing — the
 * app would have told the user to install something they already had, which is
 * a worse onboarding failure than saying nothing.
 */
function probePath(): string {
  const home = os.homedir();
  const extra = [
    path.join(home, ".local/bin"),
    path.join(home, "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  const current = process.env.PATH ?? "";
  const seen = new Set(current.split(path.delimiter).filter(Boolean));
  const additions = extra.filter((dir) => !seen.has(dir));
  return [current, ...additions].filter(Boolean).join(path.delimiter);
}

/**
 * First line of the tool's version output, trimmed.
 *
 * `docker --version` and friends occasionally print several lines, and kubectl
 * prints YAML; one line is all the UI shows.
 */
export function firstVersionLine(raw: string): string | null {
  const line = raw.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  return line ? line.slice(0, 120) : null;
}

async function gitProbeBin(): Promise<string | null> {
  const gate = await assessGitAvailability({
    env: { ...process.env, PATH: probePath() },
    augment: false,
  });
  return gate.runnable && gate.bin ? gate.bin : null;
}

export async function probeDependency(spec: DependencySpec, timeoutMs = 2500): Promise<DependencyStatus> {
  let version: string | null = null;
  let present = false;
  const command = spec.bin === "git" || spec.bin === "git.exe" ? await gitProbeBin() : spec.bin;
  if (command) {
    try {
      const { stdout } = await execExternal(command, spec.versionArgs, {
        timeoutMs,
        env: { ...process.env, PATH: probePath() },
      });
      present = true;
      version = firstVersionLine(stdout);
    } catch {
      // ENOENT (not installed), non-zero exit, or timeout all mean "can't use it".
      present = false;
    }
  }
  if (!present && spec.id === "cursor" && findInstalledApp("Cursor", "cursor")) {
    present = true;
  }
  const bundled = present && (spec.id === "node" || spec.id === "npm") && Boolean(process.env.DEVHUB_MANAGED_NODE_BIN);
  return {
    id: spec.id,
    label: spec.label,
    required: spec.required,
    unlocks: bundled ? "Included with DevHub for Agents" : spec.unlocks,
    present,
    bundled,
    version,
    installCommand: bundled ? undefined : spec.installCommand,
    installUrl: bundled ? undefined : spec.installUrl,
    macGitInstall: spec.id === "git" && (spec.bin === "git" || spec.bin === "git.exe") && process.platform === "darwin" && !present,
  };
}

export interface DependencyReport {
  tools: DependencyStatus[];
  /** Every required tool is present. */
  ready: boolean;
  missingRequired: string[];
  availableCount: number;
  totalCount: number;
}

export function summariseDependencies(tools: DependencyStatus[]): DependencyReport {
  const missingRequired = tools.filter((t) => t.required && !t.present).map((t) => t.label);
  return {
    tools,
    ready: missingRequired.length === 0,
    missingRequired,
    availableCount: tools.filter((t) => t.present).length,
    totalCount: tools.length,
  };
}

export interface RuntimeRequirementContext {
  /** Installed desktop app — Node is bundled, so the user needs none. */
  desktop: boolean;
  /**
   * The user picked at least one goal that involves their code.
   *
   * Git is required for repositories, PRs, and Upstarts. It is not required to
   * write a note. Telling a notes-and-tasks user their setup is incomplete
   * because they lack a version control system is how a setup screen becomes a
   * wall of red that reads as "this app is broken".
   */
  codeGoals: boolean;
}

/**
 * Adjust which tools are *required* for this runtime and these goals.
 *
 * Requiredness is contextual, and the old flat list pretended it wasn't. The
 * shipped app bundles its own Node runtime, so demanding a system Node from
 * someone who downloaded an installer is both false and unfixable-looking.
 *
 * Note the bundled runtime runs *DevHub*, not the user's projects. Once a repo
 * is selected, that repo's own runtime requirements are a separate question and
 * are detected then — see the Upstart flow.
 */
export function applyRuntimeRequirements(
  tools: DependencyStatus[],
  ctx: RuntimeRequirementContext,
): DependencyStatus[] {
  return tools.map((tool) => {
    if (tool.id === "node" && ctx.desktop) {
      return {
        ...tool,
        required: false,
        unlocks: tool.bundled ? "Included with DevHub for Agents" : "Running your own projects — DevHub itself uses its bundled runtime",
      };
    }
    if (tool.id === "git") {
      return { ...tool, required: ctx.codeGoals };
    }
    return tool;
  });
}

export async function checkDependencies(
  specs: DependencySpec[] = DEPENDENCIES,
  ctx?: RuntimeRequirementContext,
): Promise<DependencyReport> {
  const installContext: InstallContext = {
    platform: process.platform,
    wsl: Boolean(process.env.WSL_DISTRO_NAME),
    apt: fs.existsSync("/usr/bin/apt-get"),
    homebrew: fs.existsSync("/opt/homebrew/bin/brew") || fs.existsSync("/usr/local/bin/brew"),
  };
  const probed: DependencyStatus[] = [];
  for (const spec of specs) {
    probed.push(await probeDependency(withInstallHints(spec, installContext)));
  }
  return summariseDependencies(ctx ? applyRuntimeRequirements(probed, ctx) : probed);
}
