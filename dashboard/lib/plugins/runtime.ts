/**
 * Copy and runtime facts for plugin management. Kept free of Git so the page
 * and the CLI can share it.
 */
import fs from "node:fs";
import path from "node:path";

export type RuntimeKind = "macos" | "linux" | "wsl";

export interface ServiceRuntime {
  kind: RuntimeKind;
  distro: string | null;
  /** "This Mac", "This computer", or "{distro} (WSL)". */
  label: string;
  storageLine: string;
  syncHeading: string;
  /** Extra line under the sync targets; only Windows needs one. */
  syncNote: string | null;
}

export function serviceRuntime(env: NodeJS.ProcessEnv = process.env): ServiceRuntime {
  const distro = env.WSL_DISTRO_NAME?.trim() || null;
  if (distro) {
    return {
      kind: "wsl",
      distro,
      label: `${distro} (WSL)`,
      storageLine: `The download will be stored in ${distro} (WSL), where DevHub runs.`,
      syncHeading: `Sync to tools in ${distro}`,
      syncNote: `These are the tool folders in ${distro}. Windows-native tool configurations are separate.`,
    };
  }
  if (process.platform === "darwin") {
    return {
      kind: "macos",
      distro: null,
      label: "This Mac",
      storageLine: "The download will be stored on this Mac.",
      syncHeading: "Sync to",
      syncNote: null,
    };
  }
  return {
    kind: "linux",
    distro: null,
    label: "This computer",
    storageLine: "The download will be stored on this computer.",
    syncHeading: "Sync to",
    syncNote: null,
  };
}

/**
 * Where an executable name resolves on PATH. Looks the name up in the
 * filesystem and never runs it: a plugin's requirement list must not be able
 * to turn "is it installed?" into execution.
 */
export function whichOnPath(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!/^[A-Za-z0-9._+-]+$/.test(command)) return null;
  const dirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32"
    ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
    : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // next candidate
      }
    }
  }
  return null;
}

export function commandOnPath(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return whichOnPath(command, env) !== null;
}

export function shellQuote(value: string): string {
  if (!/^https:\/\/github\.com\/[A-Za-z0-9._/-]+$/.test(value)) {
    throw new Error("Refusing to quote an unexpected repository URL");
  }
  return `'${value}'`;
}

/** Replace the home prefix so diagnostics are not a full home path. */
export function aliasHome(filePath: string, home: string): string {
  const resolved = path.resolve(filePath);
  const root = path.resolve(home);
  if (resolved === root) return "<home>";
  if (resolved.startsWith(root + path.sep)) return `<home>${resolved.slice(root.length)}`;
  return "<path>";
}

/** Home-relative display form for paths the person is meant to read and copy. */
export function tildePath(filePath: string, home: string): string {
  const resolved = path.resolve(filePath);
  const root = path.resolve(home);
  if (resolved === root) return "~";
  if (resolved.startsWith(root + path.sep)) return `~${resolved.slice(root.length)}`;
  return resolved;
}

export function shortSha(sha: string | null | undefined): string | null {
  if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) return null;
  return sha.slice(0, 7);
}

export function ensureSecureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Windows filesystems may reject POSIX modes.
  }
}

export function secureFile(file: string): void {
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort.
  }
}
