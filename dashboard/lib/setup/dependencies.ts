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
import { execFileSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import { findInstalledApp } from "@/lib/launch/desktop";
import path from "node:path";
import { assessGitAvailabilitySync } from "@/lib/setup/git-availability";

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

export type DependencyId =
  | "git"
  | "gh"
  | "node"
  | "npm"
  | "safe-chain"
  | "docker"
  | "aws"
  | "kubectl"
  | "cursor"
  | "claude";

export interface DependencySpec {
  id: DependencyId;
  /** Human name as the user would say it. */
  label: string;
  /** Required tools block core function; optional ones gate a feature. */
  required: boolean;
  /** Plain-language description of what having it unlocks. */
  unlocks: string;
  /** The binary to look for. */
  bin: string;
  /** Args that make the tool print a version cheaply and exit non-interactively. */
  versionArgs: string[];
  /** Copyable install command, adjusted for the host before returning a report. */
  installCommand?: string;
  /** Where to read more, when a one-liner won't do it. */
  installUrl?: string;
}

export interface DependencyStatus {
  bundled?: boolean;
  id: DependencyId;
  label: string;
  required: boolean;
  unlocks: string;
  present: boolean;
  version: string | null;
  installCommand?: string;
  installUrl?: string;
  /**
   * macOS, and the only git we can see is Apple's shim with no developer
   * directory. The Tools step offers Install Git instead of running git.
   */
  macGitInstall?: boolean;
}

export const DEPENDENCIES: DependencySpec[] = [
  {
    id: "git",
    label: "Git",
    required: true,
    unlocks: "Reading your repositories - DevHub can't do much without it",
    bin: "git",
    versionArgs: ["--version"],
    installCommand: "xcode-select --install",
    installUrl: "https://git-scm.com/downloads",
  },
  {
    id: "node",
    label: "Node.js",
    // Required in a checkout (you have to run the thing), not in the installed
    // app, which ships its own runtime. `applyRuntimeRequirements` flips this.
    required: true,
    unlocks: "Running DevHub itself",
    bin: "node",
    versionArgs: ["--version"],
    installCommand: "brew install node",
  },
  {
    id: "npm",
    label: "npm",
    required: false,
    unlocks: "Installing agent tools — included with the packaged DevHub runtime",
    bin: "npm",
    versionArgs: ["--version"],
    installCommand: "brew install node",
    installUrl: "https://nodejs.org/en/download",
  },
  {
    id: "safe-chain",
    label: "Safe-Chain",
    required: false,
    unlocks: "Checking packages when installing Agents and other npm tools — needs npm first",
    bin: "safe-chain",
    versionArgs: ["--version"],
    installUrl: "https://github.com/AikidoSec/safe-chain",
  },
  {
    id: "gh",
    label: "GitHub CLI",
    required: false,
    unlocks: "Pull requests, cloning, and repository search",
    bin: "gh",
    versionArgs: ["--version"],
    installCommand: "brew install gh",
  },
  {
    id: "docker",
    label: "Docker",
    required: false,
    unlocks: "Starting a repository's services with one click",
    bin: "docker",
    versionArgs: ["--version"],
    installUrl: "https://docs.docker.com/desktop/install/mac-install/",
  },
  {
    id: "aws",
    label: "AWS CLI",
    required: false,
    unlocks: "Infrastructure panels and cloud credentials",
    bin: "aws",
    versionArgs: ["--version"],
    installCommand: "brew install awscli",
  },
  {
    id: "kubectl",
    label: "kubectl",
    required: false,
    unlocks: "Kubernetes context and cluster views",
    bin: "kubectl",
    // Plain, not --output=yaml: the YAML form makes the first line
    // "clientVersion:", which is a header, not a version.
    versionArgs: ["version", "--client=true"],
    installCommand: "brew install kubectl",
  },
  {
    id: "cursor",
    label: "Cursor",
    required: false,
    unlocks: "Opening a repository straight into the editor",
    bin: "cursor",
    versionArgs: ["--version"],
    installUrl: "https://cursor.com/downloads",
  },
  {
    id: "claude",
    label: "Claude Code",
    required: false,
    unlocks: "Agent handoffs and code review from DevHub",
    bin: "claude",
    versionArgs: ["--version"],
    installCommand: "curl -fsSL https://claude.ai/install.sh | bash",
    installUrl: "https://code.claude.com/docs/en/setup",
  },
];

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

/**
 * Probe a single tool.
 *
 * `execFileSync` (not `exec`) so nothing goes through a shell — the binary name
 * is from our own list, but running user-influenced strings through a shell is a
 * habit worth not having. A short timeout matters because a broken Docker
 * install can hang `docker --version` indefinitely, and this runs on a page load.
 */
function gitProbeBin(): string | null {
  const gate = assessGitAvailabilitySync({
    env: { ...process.env, PATH: probePath() },
    augment: false,
  });
  return gate.runnable && gate.bin ? gate.bin : null;
}

export function probeDependency(spec: DependencySpec, timeoutMs = 2500): DependencyStatus {
  let version: string | null = null;
  let present = false;
  const command = spec.bin === "git" || spec.bin === "git.exe" ? gitProbeBin() : spec.bin;
  if (command) {
    try {
      const out = execFileSync(command, spec.versionArgs, {
        encoding: "utf8",
        timeout: timeoutMs,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: probePath() },
      });
      present = true;
      version = firstVersionLine(out);
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

interface InstallContext {
  platform: NodeJS.Platform;
  wsl: boolean;
  apt: boolean;
  homebrew: boolean;
}

/** An install action must run where the dashboard runs, including inside WSL. */
export function withInstallHints(spec: DependencySpec, ctx: InstallContext): DependencySpec {
  const urls: Record<DependencyId, string> = {
    git: "https://git-scm.com/downloads",
    node: "https://nodejs.org/en/download",
    npm: "https://nodejs.org/en/download",
    "safe-chain": "https://github.com/AikidoSec/safe-chain",
    gh: "https://cli.github.com/",
    docker: ctx.platform === "darwin"
      ? "https://docs.docker.com/desktop/setup/install/mac-install/"
      : ctx.platform === "win32" || ctx.wsl
        ? "https://docs.docker.com/desktop/setup/install/windows-install/"
        : "https://docs.docker.com/desktop/setup/install/linux/",
    aws: "https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html",
    kubectl: "https://kubernetes.io/docs/tasks/tools/",
    cursor: "https://cursor.com/downloads",
    claude: "https://code.claude.com/docs/en/setup",
  };
  let installCommand = spec.installCommand;
  if (ctx.platform !== "darwin" || (!ctx.homebrew && installCommand?.startsWith("brew "))) {
    installCommand = undefined;
  }
  if (spec.id === "git" && ctx.platform === "linux" && ctx.apt) {
    installCommand = "sudo apt-get update && sudo apt-get install -y git";
  }
  if (spec.id === "safe-chain" && (ctx.platform === "darwin" || ctx.platform === "linux")) {
    installCommand = 'npm install -g @aikidosec/safe-chain@1.1.10 --prefix "$HOME/.local" && "$HOME/.local/bin/safe-chain" setup';
    const managedBin = process.env.DEVHUB_MANAGED_NODE_BIN;
    if (managedBin) {
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
      const prefix = path.join(os.homedir(), ".local", "share", "devhub", "tools");
      const commandPath = `PATH=${quote(`${managedBin}:${path.join(prefix, "bin")}`)}:"$PATH"`;
      installCommand = `${commandPath} ${quote(path.join(managedBin, "npm"))} install -g @aikidosec/safe-chain@1.1.10 --prefix ${quote(prefix)} && ${commandPath} ${quote(path.join(prefix, "bin", "safe-chain"))} setup`;
    }
  }
  if (spec.id === "claude") {
    installCommand = ctx.platform === "win32"
      ? "irm https://claude.ai/install.ps1 | iex"
      : "curl -fsSL https://claude.ai/install.sh | bash";
  }
  return { ...spec, installCommand, installUrl: urls[spec.id] };
}

export function checkDependencies(
  specs: DependencySpec[] = DEPENDENCIES,
  ctx?: RuntimeRequirementContext,
): DependencyReport {
  const installContext: InstallContext = {
    platform: process.platform,
    wsl: Boolean(process.env.WSL_DISTRO_NAME),
    apt: fs.existsSync("/usr/bin/apt-get"),
    homebrew: fs.existsSync("/opt/homebrew/bin/brew") || fs.existsSync("/usr/local/bin/brew"),
  };
  const probed = specs.map((spec) => probeDependency(withInstallHints(spec, installContext)));
  return summariseDependencies(ctx ? applyRuntimeRequirements(probed, ctx) : probed);
}
