import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { pluginContext } from "./context";
import { confirmOperation, prepareLocal, startLifecycle } from "./operations";
import { loadRuntime } from "./runtime-host";
import { runtimeNavigation } from "./runtime-nav";
import { readManifest } from "./manifest";
import type { PluginOperationView } from "../../../../../packages/shared/ui-lib/plugins/model";

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function consent(view: PluginOperationView) {
  if (!view.preview) throw new Error("Missing preview");
  return { accepted: true, revision: view.preview.revision, planDigest: view.preview.planDigest, selectedTargets: [] };
}
function fixture() {
  vi.stubEnv("DEVHUB_CORE_ROUTE_NAMESPACES", JSON.stringify(["/work", "/plugins", "/api/tasks"]));
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-nav-")));
  roots.push(root);
  const source = path.join(root, "source");
  fs.cpSync(path.resolve("../../templates/runtime-plugin"), source, { recursive: true });
  const parsed = readManifest(source);
  if (!parsed.ok || !parsed.manifest.runtime) throw new Error("Bad fixture");
  const manifest = parsed.manifest;
  manifest.runtime!.pages = [{ path: "/overview", label: "Overview" }, { path: "/details", label: "Details" }];
  manifest.runtime!.aliases = [{ kind: "page", path: "/fixture-nav", target: "/overview" }];
  manifest.runtime!.nav = [
    { href: "/fixture-nav", label: "Fixture navigation", icon: "skills", group: "library", section: "library" },
  ];
  const save = () => fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
  save();
  const ctx = pluginContext({ home: root, repoRoot: root, env: { NODE_ENV: "test", DEVHUB_CONFIG_DIR: path.join(root, "config"), DEVHUB_PLUGIN_HOME: path.join(root, "managed"), DEVHUB_PLUGIN_TARGET_HOME: path.join(root, "targets") } });
  const install = async (directory = source, replace = false) => {
    const review = await prepareLocal(ctx, directory, { reviewRuntimeReplacement: replace });
    expect(review.preview?.canApply, JSON.stringify({ blockers: review.preview?.blockers, issues: review.issues, requirements: review.preview?.requirements })).toBe(true);
    expect((await confirmOperation(ctx, review.id, consent(review))).state).toBe("succeeded");
    return review;
  };
  return { source, ctx, manifest, save, install };
}

it("exposes only approved navigation and follows disable, enable and reviewed replacement", async () => {
  const { ctx, manifest, save, install } = fixture();
  expect(runtimeNavigation(ctx).items).toEqual([]);
  const review = await install();
  expect(review.preview?.inventory.find(group => group.kind === "Navigation")?.entries.join(" ")).toContain("Fixture navigation");
  const initial = runtimeNavigation(ctx);
  expect(initial.errors).toEqual([]);
  expect(initial.items).toMatchObject([
    { href: "/plugins/runtime/sample-tools?page=%2Foverview", label: "Fixture navigation", sidebar: true, section: "library", keywords: "/fixture-nav" },
    { href: "/plugins/runtime/sample-tools?page=%2Fdetails", label: "Details", sidebar: false, parent: "/plugins/runtime/sample-tools?page=%2Foverview" },
  ]);
  for (const action of ["disable", "enable"] as const) {
    const operation = await startLifecycle(ctx, "sample-tools", action);
    await confirmOperation(ctx, operation.id, consent(operation));
    expect(runtimeNavigation(ctx).items).toHaveLength(action === "disable" ? 0 : 2);
  }
  manifest.runtime!.nav![0].label = "Updated navigation";
  save();
  expect(runtimeNavigation(ctx)).toEqual(initial);
  await install(undefined, true);
  expect(runtimeNavigation(ctx).items[0].label).toBe("Updated navigation");
  const loaded = loadRuntime(ctx, "sample-tools");
  fs.appendFileSync(path.join(loaded.root, "devhub-plugin.json"), " ");
  expect(runtimeNavigation(ctx).items).toEqual([]);
});

it("rejects nav targets outside declared pages and aliases, including core routes and external URLs", async () => {
  for (const href of ["/work", "/work/child", "//evil.invalid", "https://evil.invalid", "javascript:alert(1)", "/undeclared", "/plugins/runtime/other?page=%2Foverview", "/fixture-nav?other=1"]) {
    const { ctx, manifest, save, install } = fixture();
    manifest.runtime!.nav![0].href = href;
    save();
    await install();
    expect(runtimeNavigation(ctx)).toMatchObject({ items: [], errors: [expect.stringContaining("sample-tools")] });
  }
});

it("refuses core aliases and collisions even when the other owner is disabled", async () => {
  const { ctx, source, manifest, save, install } = fixture();
  await install();
  const other = path.join(path.dirname(source), "other");
  fs.cpSync(source, other, { recursive: true });
  fs.writeFileSync(path.join(other, "devhub-plugin.json"), JSON.stringify({ ...manifest, name: "other-tools" }));
  await install(other);
  expect(runtimeNavigation(ctx).items).toEqual([]);
  expect(runtimeNavigation(ctx).errors).toHaveLength(2);
  const disable = await startLifecycle(ctx, "other-tools", "disable");
  await confirmOperation(ctx, disable.id, consent(disable));
  expect(runtimeNavigation(ctx)).toMatchObject({ items: [], errors: [expect.stringContaining("sample-tools")] });
  manifest.runtime!.aliases![0].path = "/work/child";
  manifest.runtime!.nav![0].href = "/work/child";
  save();
  await install(undefined, true);
  expect(runtimeNavigation(ctx).items).toEqual([]);
});

it("rejects ambiguous page metadata and unknown gates without granting a new destination", async () => {
  const { ctx, manifest, save, install } = fixture();
  manifest.runtime!.nav!.push({ ...manifest.runtime!.nav![0] });
  save();
  await install();
  expect(runtimeNavigation(ctx).items).toEqual([]);
  manifest.runtime!.nav!.pop();
  manifest.navGate = "unknown-gate";
  save();
  await install(undefined, true);
  expect(runtimeNavigation(ctx).items).toEqual([]);
});
