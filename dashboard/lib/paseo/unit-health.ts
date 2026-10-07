import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The first `ExecStart=` token of a systemd unit (the daemon's executable), unquoted. */
export function unitExecBinary(unit: string): string | null {
  for (const line of unit.split(/\r?\n/)) {
    if (!line.startsWith("ExecStart=")) continue;
    const value = line.slice("ExecStart=".length);
    const quoted = /^"((?:[^"\\]|\\.)*)"/.exec(value);
    const token = quoted ? quoted[1].replace(/\\(.)/g, "$1").replaceAll("%%", "%").replaceAll("$$", "$") : value.split(/\s/)[0];
    return token || null;
  }
  return null;
}

/**
 * The executable the managed Paseo service runs, when it no longer exists.
 *
 * An app update used to delete the versioned payload an older unit pointed at;
 * the running daemon kept working, and the next restart failed with 203/EXEC.
 * Surfacing it lets Agents → Connection say so before that restart happens.
 */
export function missingPaseoUnitBinary(home: string = os.homedir()): string | null {
  if (process.platform !== "linux") return null;
  let unit: string;
  try {
    unit = fs.readFileSync(path.join(home, ".config", "systemd", "user", "devhub-paseo.service"), "utf8");
  } catch {
    return null;
  }
  const binary = unitExecBinary(unit);
  if (!binary) return null;
  try {
    fs.accessSync(binary, fs.constants.X_OK);
    return null;
  } catch {
    return binary;
  }
}
