import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { collectPluginDbProviders } from "./db-materialize";
import { integrationSource } from "./integration-materialize";
import { readManifest } from "./manifest";
import type { RegisteredPlugin } from "./types";
const roots: string[] = [];
function fixture(): RegisteredPlugin {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-provider-")); roots.push(root);
  fs.mkdirSync(path.join(root, "dashboard/lib"), { recursive: true }); fs.writeFileSync(path.join(root, "dashboard/lib/example.ts"), "export default [];");
  return { name: "example", path: root, enabled: true, manifest: { name: "example", version: "1", devhubApi: "1", contributes: {}, dashboard: { root: "dashboard", paths: ["lib/example.ts"], providers: "lib/example.ts" } } };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it("registers source arrays, with an empty core-only baseline and no disabled imports", () => {
  const plugin = fixture();
  const result = collectPluginDbProviders([plugin], "providers");
  expect(result.errors).toEqual([]);
  expect(integrationSource(result.providers)).toContain('import IntegrationModule0 from "./example"');
  expect(integrationSource(result.providers)).toContain("...IntegrationModule0");
  expect(integrationSource(collectPluginDbProviders([{ ...plugin, enabled: false }], "providers").providers)).toContain("IntegrationProvider[] = []");
  fs.writeFileSync(path.join(plugin.path, "devhub-plugin.json"), JSON.stringify(plugin.manifest));
  expect(readManifest(plugin.path).ok).toBe(true);
});
it("rejects undeclared paths, traversal and symlink escapes", () => {
  const plugin = fixture();
  plugin.manifest.dashboard!.paths = ["app/example"];
  expect(collectPluginDbProviders([plugin], "providers").errors[0]).toContain("not covered");
  plugin.manifest.dashboard!.providers = "lib/../../outside.ts";
  fs.writeFileSync(path.join(plugin.path, "devhub-plugin.json"), JSON.stringify(plugin.manifest));
  expect(readManifest(plugin.path).ok).toBe(false);
  plugin.manifest.dashboard!.paths = ["lib/example.ts"]; plugin.manifest.dashboard!.providers = "lib/example.ts";
  fs.unlinkSync(path.join(plugin.path, "dashboard/lib/example.ts"));
  fs.writeFileSync(path.join(plugin.path, "outside.ts"), "export default [];");
  fs.symlinkSync(path.join(plugin.path, "outside.ts"), path.join(plugin.path, "dashboard/lib/example.ts"));
  expect(collectPluginDbProviders([plugin], "providers").errors[0]).toContain("escapes");
});
