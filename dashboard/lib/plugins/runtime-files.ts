import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RuntimeContribution } from "./runtime-contract";

export function runtimeFile(root: string, relative: string): string {
  if (!relative || relative.includes("\\") || path.isAbsolute(relative) || relative.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Unsafe runtime path");
  const base = fs.realpathSync(root);
  let current = base;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Unsafe runtime path");
  }
  if (!fs.statSync(current).isFile()) throw new Error("Runtime bundle is missing");
  return current;
}

export function verifyRuntimeFiles(root: string, runtime: RuntimeContribution): void {
  const assets = [{ path: runtime.entry, sha256: runtime.sha256 }, runtime.lockfile, runtime.branding?.logo, runtime.branding?.font];
  for (const asset of assets) {
    if (!asset) continue;
    const file = runtimeFile(root, asset.path);
    if (fs.statSync(file).size > 16 * 1024 * 1024) throw new Error("Runtime file is too large");
    if (crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== asset.sha256) throw new Error("Runtime files failed verification");
  }
  const lock = JSON.parse(fs.readFileSync(runtimeFile(root, runtime.lockfile.path), "utf8"));
  if (!lock || typeof lock !== "object" || !Number.isInteger(lock.lockfileVersion) || !lock.packages || typeof lock.packages !== "object") throw new Error("Runtime dependency lockfile is invalid");
}
