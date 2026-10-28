/**
 * Pre-push verify checks this checkout, not the plugins installed on this machine.
 * A materialised copy of an installed plugin can import code this checkout lacks
 * (a private plugin on a public checkout), so verify syncs an empty plugin set.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * With DEVHUB_VERIFY_CORE_ONLY=1, point plugin resolution at a fresh empty config
 * dir so sync_plugins materialises nothing and prunes earlier copies. Returns the
 * dir (caller removes it), or null when the flag is off.
 */
export function isolatePluginsForVerify(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.DEVHUB_VERIFY_CORE_ONLY !== "1") return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-verify-plugins-"));
  env.DEVHUB_CONFIG_DIR = dir;
  delete env.DEVHUB_PLUGIN_HOME;
  delete env.DEVHUB_APP_DATA;
  return dir;
}
