import os from "node:os";
import path from "node:path";

/**
 * Turn a path the user typed into setup into one this server can use.
 *
 * On Windows the dashboard runs inside WSL, but people naturally type or paste
 * the path Explorer shows them: `C:\Users\me\code`, or
 * `\\wsl.localhost\Ubuntu\home\me\dev` for a folder already inside the distro.
 * Without translation both fail as "Path must be absolute", which reads as
 * "that folder is wrong" when it is only written in the other OS's notation.
 *
 * Mirrors `to_wsl_path` in `desktop/src-tauri/src/wsl.rs`, which does the same
 * for paths chosen through the native folder picker.
 */
export function windowsPathToWsl(input: string): string | null {
  const value = input.startsWith("\\\\?\\") ? input.slice(4) : input;

  for (const prefix of ["\\\\wsl.localhost\\", "\\\\wsl$\\"]) {
    if (value.slice(0, prefix.length).toLowerCase() === prefix) {
      const rest = value.slice(prefix.length);
      const split = rest.indexOf("\\");
      const inner = split === -1 ? "" : rest.slice(split + 1);
      return `/${inner.replace(/\\/g, "/").replace(/^\/+/, "")}`;
    }
  }

  const drive = /^([a-zA-Z]):(.*)$/.exec(value);
  if (drive) {
    const letter = drive[1].toLowerCase();
    const rest = drive[2].replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
    return rest ? `/mnt/${letter}/${rest}` : `/mnt/${letter}`;
  }
  return null;
}

export interface SetupPathContext {
  home: string;
  /** The server runs inside a WSL distro (the Windows desktop app). */
  wsl: boolean;
}

function defaultContext(): SetupPathContext {
  return { home: os.homedir(), wsl: Boolean(process.env.WSL_DISTRO_NAME) };
}

/**
 * Expand `~`, translate Windows notation when running in WSL, and resolve.
 * Relative input is returned unresolved so callers can still reject it.
 */
export function resolveSetupPath(raw: string, ctx: SetupPathContext = defaultContext()): string {
  const value = raw.trim();
  if (!value) return value;
  if (value === "~") return ctx.home;
  if (value.startsWith("~/")) return path.posix.join(ctx.home, value.slice(2));
  if (ctx.wsl) {
    const translated = windowsPathToWsl(value);
    if (translated) return translated;
  }
  return path.isAbsolute(value) ? path.resolve(value) : value;
}

/**
 * Why a typed path can never work, or null. `\\server\share` has no WSL
 * equivalent, and "Path must be absolute" sends people hunting for a typo.
 */
export function unsupportedPathMessage(raw: string, ctx: SetupPathContext = defaultContext()): string | null {
  const value = raw.trim();
  if (!value.startsWith("\\\\") || value.startsWith("\\\\?\\")) return null;
  if (ctx.wsl && windowsPathToWsl(value)) return null;
  return "Network shares (\\\\server\\share) aren't supported. Choose a folder on this PC or inside Ubuntu.";
}
