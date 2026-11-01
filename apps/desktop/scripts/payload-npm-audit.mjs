/**
 * The credential, musl, and symlink rules from `verify-staging.mjs`, applied
 * to the npm tree the Windows payload ships.
 *
 * `verify-staging` walks `staging/resources` and `staging/server` only. The
 * payload copies npm in afterwards, at `runtime/lib/node_modules/npm`, so
 * those walks never see it. This is the same three predicates, rooted at the
 * npm directory, run before that copy.
 *
 * npm's own tree contains markdown, a nested `node_modules`, and node-gyp's
 * `addon.gypi`. None of those are failures here. A credential-shaped name, a
 * musl-linked native binary, or a symlink that dangles or leaves the tree is.
 */
import fs from "node:fs";
import path from "node:path";
import { NATIVE_BINARY_PATTERN, isMuslLinked } from "./native-binaries.mjs";

/** Same filename patterns as `verify-staging.mjs`. */
export const CREDENTIAL_FILES = [/(^|\/)\.env(\.|$)/, /\.pem$/i, /\.key$/i, /id_rsa/i];

/**
 * Problems in `root`, or an empty list when the tree can ship.
 * Symlinks are not followed. An in-tree relative link is fine; `cp` later
 * dereferences it. A link that escapes would otherwise be copied in.
 */
export function auditPayloadNpm(root) {
  const failures = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      failures.push(`cannot read ${dir}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        let target;
        try {
          target = fs.readlinkSync(full);
        } catch (err) {
          failures.push(`${rel} (unreadable symlink: ${err instanceof Error ? err.message : String(err)})`);
          continue;
        }
        const resolved = path.resolve(path.dirname(full), target);
        if (!fs.existsSync(resolved)) failures.push(`${rel} -> ${target} (dangling)`);
        else if (path.relative(root, resolved).startsWith("..")) {
          failures.push(`${rel} -> ${resolved} (escapes the npm tree)`);
        }
        continue;
      }
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (CREDENTIAL_FILES.some((pattern) => pattern.test(rel))) {
        failures.push(`${rel} (credential-shaped name)`);
      }
      if (entry.isFile() && NATIVE_BINARY_PATTERN.test(entry.name)) {
        try {
          if (isMuslLinked(fs.readFileSync(full))) failures.push(`${rel} (musl)`);
        } catch (err) {
          failures.push(`${rel} (unreadable: ${err instanceof Error ? err.message : String(err)})`);
        }
      }
    }
  };
  walk(root);
  return failures;
}
