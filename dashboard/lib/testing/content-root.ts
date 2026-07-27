import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Every env var that can pull a content directory out from under `REPO_ROOT`.
 *
 * `getNotesDir()` and friends prefer their own env key and only fall back to
 * `<REPO_ROOT>/<segment>`. A test that sets `REPO_ROOT` alone is therefore only
 * isolated on a machine where none of these happen to be set — which is true on
 * a bare laptop and false in CI, where the Verify workflow exports `NOTES_DIR`
 * and `DOCS_DIR`. That difference is exactly how two tests passed locally and
 * failed on the runner, so isolation has to clear the whole set, not just the
 * root.
 */
const CONTENT_DIR_ENV_KEYS = [
  "NOTES_DIR",
  "TASKS_DIR",
  "DOCS_DIR",
  "COLLECTIONS_DIR",
  "UPSTARTS_DIR",
] as const;

const ROOT_ENV_KEYS = ["REPO_ROOT", "DEVHUB_APP_DATA", "DEVHUB_RESOURCE_ROOT"] as const;

export interface ContentRoot {
  /** The temporary root; `notes`, `tasks`, … resolve underneath it. */
  root: string;
  /** Restore the previous environment and delete the temporary tree. */
  cleanup(): void;
}

/**
 * Point every content directory at a fresh temporary root.
 *
 * Prefer this over setting `REPO_ROOT` by hand in a test: it also unsets the
 * per-directory overrides, so the test reads and writes where it thinks it does
 * no matter what the surrounding environment says.
 */
export function useTempContentRoot(prefix = "devhub-test-"): ContentRoot {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const saved = new Map<string, string | undefined>();

  for (const key of [...ROOT_ENV_KEYS, ...CONTENT_DIR_ENV_KEYS]) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.REPO_ROOT = root;

  return {
    root,
    cleanup() {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
