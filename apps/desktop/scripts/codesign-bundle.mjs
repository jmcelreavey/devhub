#!/usr/bin/env node
/**
 * Signing a `DevHub.app` bundle, and why anything writes to it twice.
 *
 * macOS remembers a TCC grant (Full Disk Access, Local Network, Automation,
 * the Documents/Downloads prompts) against the app's *code signature*, not its
 * path. Two things about DevHub's local build break that memory:
 *
 * 1. **The seal.** `View → Rebuild Dashboard` rewrites
 *    `Contents/Resources/{server,services}` inside the installed bundle. Those
 *    files are sealed by the signature, so the moment they change the bundle
 *    fails `codesign --verify` — macOS then treats it as a different (and
 *    damaged) app and re-asks for everything. Anything that mutates an
 *    installed bundle has to re-sign it afterwards.
 *
 * 2. **The identity.** An ad-hoc signature has no certificate behind it, so its
 *    designated requirement is pinned to the cdhash — which changes on every
 *    single build. Grants are therefore forgotten every rebuild by design.
 *    Signing with a stable self-signed certificate instead gives a designated
 *    requirement of "this bundle id, signed by this cert", which survives
 *    rebuilds. See `ensure-signing-identity.mjs`.
 *
 * Ad-hoc remains the fallback so a checkout with no certificate still produces
 * a bundle that verifies; it just re-prompts more often.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

/** Common name of the certificate `ensure-signing-identity.mjs` creates. */
export const LOCAL_SIGNING_IDENTITY = "DevHub Local Signing";

/**
 * Pick the identity to sign with.
 *
 * `DEVHUB_SIGN_IDENTITY` wins (that's where a real Developer ID goes), then the
 * stable local certificate, then ad-hoc.
 */
export function resolveSigningIdentity() {
  const configured = process.env.DEVHUB_SIGN_IDENTITY?.trim();
  if (configured) return { identity: configured, kind: "configured" };
  if (hasLocalSigningIdentity()) return { identity: LOCAL_SIGNING_IDENTITY, kind: "local-cert" };
  return { identity: "-", kind: "adhoc" };
}

export function hasLocalSigningIdentity() {
  const res = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return (res.stdout ?? "").includes(LOCAL_SIGNING_IDENTITY);
}

function sign(target, identity) {
  execFileSync("codesign", ["--force", "--sign", identity, "--timestamp=none", target], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

/**
 * Every Mach-O the bundle carries, deepest first.
 *
 * `.node` files are native addons — Mach-O dylibs that macOS treats as code.
 * An unsigned one inside a signed bundle is exactly the mismatch that makes
 * `--strict` fail, and it is easy to miss because nothing about the filename
 * says "executable".
 */
export function nestedBinaries(app) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isSymbolicLink()) continue;
      if (entry.name.endsWith(".node") || entry.name.endsWith(".dylib")) {
        found.push(full);
        continue;
      }
      // Extensionless files with the executable bit are the bundled runtime.
      const stat = fs.statSync(full);
      if (!path.extname(entry.name) && stat.mode & 0o111) found.push(full);
    }
  };
  walk(path.join(app, "Contents"));
  // Deepest first: a parent signed before its children is a parent whose
  // signature the children then invalidate.
  return found.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
}

/**
 * Sign `app` inside-out. Returns what it signed and with which identity.
 *
 * Signing order is load-bearing: sealing the bundle first and the nested
 * binaries afterwards invalidates the outer signature, which is the single
 * most common way "I signed it" produces a bundle that fails verification.
 */
export function signBundle(app, { identity } = {}) {
  const resolved = identity ? { identity, kind: "configured" } : resolveSigningIdentity();
  const binaries = nestedBinaries(app);
  for (const binary of binaries) sign(binary, resolved.identity);
  sign(app, resolved.identity);
  return { ...resolved, nested: binaries.length };
}

/** True when the bundle's seal is intact. */
export function verifyBundle(app) {
  const res = spawnSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
  });
  return { ok: res.status === 0, output: (res.stderr ?? "").trim() };
}
