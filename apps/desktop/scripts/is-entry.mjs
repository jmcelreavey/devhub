import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * True when `moduleUrl` is the script Node was started with.
 *
 * Node resolves symlinks in `import.meta.url` but not in `process.argv[1]`, so
 * a string compare silently skips the script when it runs from a symlinked
 * directory (macOS os.tmpdir() is /var -> /private/var), from a path with
 * URL-escaped characters, or from a Windows drive path. Compare real paths.
 */
export function isEntry(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return fs.realpathSync(argv1) === fs.realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
