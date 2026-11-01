import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coreRouteNamespaces } from "./namespaces.generated";

function realPathWithMissingTail(directory: string): string {
  let ancestor = directory;
  while (!existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error(`Cannot resolve directory: ${directory}`);
    ancestor = parent;
  }
  return path.resolve(realpathSync(ancestor), path.relative(ancestor, directory));
}

export async function main(): Promise<void> {
  process.env.DEVHUB_CORE_SERVER = "1";
  for (const key of ["DEVHUB_RESOURCE_ROOT", "DEVHUB_APP_DATA", "DEVHUB_UI_DIST"] as const) {
    const value = process.env[key]?.trim();
    if (value) process.env[key] = path.resolve(value);
  }
  const checkoutUi = import.meta.url ? fileURLToPath(new URL("../../../ui/", import.meta.url)) : null;
  const checkoutRoot = checkoutUi ? path.resolve(checkoutUi, "../..") : process.cwd();
  const checkoutDev = checkoutUi !== null && process.env.DEVHUB_DESKTOP !== "1"
    && !process.env.DEVHUB_SERVER_DIR?.trim() && existsSync(path.join(checkoutRoot, "apps/core/src/scripts/checkout-dev-defaults.ts"));
  if (checkoutDev && checkoutUi) {
    delete process.env.DEVHUB_CORE_PAYLOAD;
    process.chdir(checkoutUi);
    const { loadEnvLocalIntoProcessIfUnset } = await import("../scripts/load-env-local-into-process");
    const { loadEnvWithOnePasswordFallback } = await import("../scripts/op-secrets");
    const { applyCheckoutDevDefaults } = await import("../scripts/checkout-dev-defaults");
    loadEnvLocalIntoProcessIfUnset(checkoutUi, { mode: "development" });
    await loadEnvWithOnePasswordFallback(checkoutUi);
    applyCheckoutDevDefaults();
  } else {
    if (!process.env.DEVHUB_RESOURCE_ROOT?.trim() || !process.env.DEVHUB_APP_DATA?.trim()) {
      throw new Error("DEVHUB_RESOURCE_ROOT and DEVHUB_APP_DATA are required for a staged payload");
    }
    process.env.DEVHUB_CORE_PAYLOAD = "1";
  }
  const resourceRoot = path.resolve(process.env.DEVHUB_RESOURCE_ROOT?.trim() || checkoutRoot);
  const dataRoot = path.resolve(process.env.DEVHUB_APP_DATA?.trim() || checkoutRoot);
  if (!checkoutDev) {
    if (!statSync(resourceRoot).isDirectory()) throw new Error("DEVHUB_RESOURCE_ROOT must be a directory");
    const relativeData = path.relative(realpathSync(resourceRoot), realPathWithMissingTail(dataRoot));
    if (!relativeData || (!relativeData.startsWith(`..${path.sep}`) && relativeData !== ".." && !path.isAbsolute(relativeData))) {
      throw new Error("DEVHUB_APP_DATA must be outside DEVHUB_RESOURCE_ROOT");
    }
  }
  const uiDist = path.resolve(process.env.DEVHUB_UI_DIST?.trim() || path.join(resourceRoot, checkoutDev ? "apps/ui/dist" : "ui/dist"));
  process.env.DEVHUB_RESOURCE_ROOT = resourceRoot;
  process.env.DEVHUB_APP_DATA = dataRoot;
  process.env.DEVHUB_CORE_ROUTE_NAMESPACES = JSON.stringify(coreRouteNamespaces);
  const requestedHost = process.env.DEVHUB_BIND_HOST?.trim() || "127.0.0.1";
  const host = ["auto", "lan"].includes(requestedHost.toLowerCase()) ? "127.0.0.1" : requestedHost;
  if (!["127.0.0.1", "localhost", "::1"].includes(host.toLowerCase())) throw new Error("DEVHUB_BIND_HOST must be a loopback address");
  const port = Number(process.env.PORT?.trim() || "1437");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535");
  process.env.DEVHUB_BIND_HOST = host;
  const { register } = await import("../instrumentation");
  await register();
  const { createCoreServer } = await import("./server");
  const server = createCoreServer({ uiDist });
  server.on("error", error => { console.error("[core-http] server failed", error); process.exit(1); });
  server.listen(port, host, () => console.info(`[core-http] listening on ${host}:${port}`));
}

