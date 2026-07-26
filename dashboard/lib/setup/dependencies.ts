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
import path from "node:path";

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
  /** Copyable install command, macOS-first since that's the supported platform. */
  installCommand?: string;
  /** Where to read more, when a one-liner won't do it. */
  installUrl?: string;
}

export interface DependencyStatus {
  id: DependencyId;
  label: string;
  required: boolean;
  unlocks: string;
  present: boolean;
  version: string | null;
  installCommand?: string;
  installUrl?: string;
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
    required: true,
    unlocks: "Running DevHub itself",
    bin: "node",
    versionArgs: ["--version"],
    installCommand: "brew install node",
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
    installUrl: "https://cursor.com",
  },
  {
    id: "claude",
    label: "Claude Code",
    required: false,
    unlocks: "Agent handoffs and code review from DevHub",
    bin: "claude",
    versionArgs: ["--version"],
    installCommand: "npm install -g @anthropic-ai/claude-code",
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
export function probeDependency(spec: DependencySpec, timeoutMs = 2500): DependencyStatus {
  let version: string | null = null;
  let present = false;
  try {
    const out = execFileSync(spec.bin, spec.versionArgs, {
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
  return {
    id: spec.id,
    label: spec.label,
    required: spec.required,
    unlocks: spec.unlocks,
    present,
    version,
    installCommand: spec.installCommand,
    installUrl: spec.installUrl,
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

export function checkDependencies(specs: DependencySpec[] = DEPENDENCIES): DependencyReport {
  return summariseDependencies(specs.map((s) => probeDependency(s)));
}
