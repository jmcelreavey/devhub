import os from "node:os";
import path from "node:path";

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

export interface InstallContext {
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

