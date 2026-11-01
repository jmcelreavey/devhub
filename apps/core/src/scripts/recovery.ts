#!/usr/bin/env tsx
import path from "node:path";
import os from "node:os";
import { createBundle, restoreBundle } from "../lib/recovery/bundle";
import { recoveryStores } from "../lib/recovery/stores";
import { getReposDir } from "../lib/desktop/runtime-paths";
import { loadEnvWithOnePasswordFallback } from "./op-secrets";

async function main() {
  const [action, file, parent, repositoriesRoot] = process.argv.slice(2);
  if (!file || (action !== "create" && action !== "restore")) throw new Error("Usage: tsx scripts/recovery.ts create FILE | restore FILE [PARENT] [NEW_REPOSITORIES_ROOT]");
  await loadEnvWithOnePasswordFallback(path.resolve(import.meta.dirname, "../../../../apps/ui"));
  const passphrase = process.env.DEVHUB_RECOVERY_PASSPHRASE;
  if (!passphrase) throw new Error("Set DEVHUB_RECOVERY_PASSPHRASE in the environment. It is never printed or passed as a command-line argument.");
  const result = action === "create"
    ? await createBundle(recoveryStores(), passphrase, path.resolve(file), getReposDir())
    : await restoreBundle(path.resolve(file), passphrase, path.resolve(parent || os.homedir()), { repositoriesRoot });
  process.stdout.write(JSON.stringify(result) + "\n");
}
void main().catch(error => {
  process.stderr.write((error instanceof Error ? error.message : "Recovery failed.") + "\n");
  process.exitCode = 1;
});
