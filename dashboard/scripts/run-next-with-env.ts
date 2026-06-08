#!/usr/bin/env tsx
/**
 * Runs `next dev` / `next start` with PORT and DEVHUB_BIND_HOST taken from the
 * environment after loading `.env.local`, so Setup "LAN vs localhost" works.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { envTrimOrDefault } from "./load-env-local-into-process";
import { loadEnvWithOnePasswordFallback } from "./op-secrets";

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  await loadEnvWithOnePasswordFallback(dashboardRoot);

  const bindHost = envTrimOrDefault("DEVHUB_BIND_HOST", "0.0.0.0");
  const port = envTrimOrDefault("PORT", "1337");

  const args = process.argv.slice(2);
  if (args.length === 0) {
    process.stderr.write("usage: tsx scripts/run-next-with-env.ts <dev|start|…> [next args…]\n");
    process.exit(1);
  }

  const sub = args[0];
  const rest = args.slice(1);
  const hasPortFlag = rest.includes("-p") || rest.includes("--port");
  const hasHostFlag = rest.includes("-H") || rest.includes("--hostname");

  const injected: string[] = [];
  if (sub === "dev" || sub === "start") {
    if (!hasPortFlag) {
      injected.push("-p", port);
    }
    if (!hasHostFlag) {
      injected.push("-H", bindHost);
    }
  }
  // Webpack resolves `../shared/` imports; Turbopack treats dashboard/ as root and cannot (without
  // widening root, which watches the whole repo and exhausts RAM). Match production `next build --webpack`.
  if (sub === "dev" && !rest.includes("--webpack") && !rest.includes("--turbo")) {
    injected.push("--webpack");
  }

  let nextCli: string;
  try {
    nextCli = require.resolve("next/dist/bin/next");
  } catch {
    process.stderr.write("Could not resolve next/dist/bin/next — run npm install in dashboard/.\n");
    process.exit(1);
  }

  const child = spawn(process.execPath, [nextCli, sub, ...injected, ...rest], {
    stdio: "inherit",
    env: process.env,
    cwd: dashboardRoot,
  });

  child.on("error", (err) => {
    process.stderr.write(`Failed to spawn Next.js: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  process.stderr.write(`Startup failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
