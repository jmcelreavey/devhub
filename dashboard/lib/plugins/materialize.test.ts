import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { planDashboardMaterialization, materializePlugins, EXCLUDE_BEGIN } from "./materialize";
import { pluginRegistryPath } from "./registry";
import type { RegisteredPlugin } from "./types";

let pluginRoot: string;

function mkPlugin(rootDir: string): RegisteredPlugin {
  return {
    name: "bi",
    path: rootDir,
    enabled: true,
    manifest: {
      name: "bi",
      version: "0.1.0",
      devhubApi: "1",
      contributes: {},
      dashboard: {
        root: "dashboard",
        paths: ["app/ops", "lib/bi-ops.ts"],
      },
    },
  };
}

beforeEach(() => {
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-plugin-"));
  fs.mkdirSync(path.join(pluginRoot, "dashboard", "app", "ops"), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, "dashboard", "app", "ops", "page.tsx"), "export default () => null;");
  fs.mkdirSync(path.join(pluginRoot, "dashboard", "lib"), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, "dashboard", "lib", "bi-ops.ts"), "export const x = 1;");
});

afterEach(() => {
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

describe("planDashboardMaterialization", () => {
  it("maps plugin dashboard paths to core dashboard paths + collects nav", () => {
    const plan = planDashboardMaterialization([mkPlugin(pluginRoot)], "/core/dashboard");
    expect(plan.errors).toEqual([]);
    expect(plan.entries.map((e) => e.rel).sort()).toEqual(["app/ops", "lib/bi-ops.ts"]);
    expect(plan.entries[0].to.startsWith("/core/dashboard")).toBe(true);
  });

  it("rejects paths that escape the plugin dashboard root", () => {
    const p = mkPlugin(pluginRoot);
    p.manifest.dashboard!.paths = ["../../../etc/passwd"];
    const plan = planDashboardMaterialization([p], "/core/dashboard");
    expect(plan.entries).toEqual([]);
    expect(plan.errors.some((e) => e.includes("escapes"))).toBe(true);
  });

  it("reports a missing source path", () => {
    const p = mkPlugin(pluginRoot);
    p.manifest.dashboard!.paths = ["app/does-not-exist"];
    const plan = planDashboardMaterialization([p], "/core/dashboard");
    expect(plan.errors.some((e) => e.includes("missing source"))).toBe(true);
  });

  it("returns nothing when a plugin has no dashboard contribution", () => {
    const p = mkPlugin(pluginRoot);
    delete p.manifest.dashboard;
    expect(planDashboardMaterialization([p], "/core/dashboard").entries).toEqual([]);
  });
});

describe("materializePlugins (executor)", () => {
  let home: string;
  let repoRoot: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-home-"));
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-repo-"));
    fs.mkdirSync(path.join(repoRoot, "dashboard"), { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: repoRoot });
    // register the plugin
    fs.writeFileSync(
      path.join(pluginRoot, "devhub-plugin.json"),
      JSON.stringify({
        name: "bi",
        version: "0.1.0",
        devhubApi: "1",
        contributes: {},
        dashboard: { root: "dashboard", paths: ["app/ops", "lib/bi-ops.ts"] },
      }),
    );
    const reg = pluginRegistryPath(home);
    fs.mkdirSync(path.dirname(reg), { recursive: true });
    fs.writeFileSync(reg, JSON.stringify({ plugins: [{ name: "bi", path: pluginRoot, enabled: true }] }));
    process.env.HOME = home;
  });

  afterEach(() => {
    for (const d of [home, repoRoot]) fs.rmSync(d, { recursive: true, force: true });
  });

  it("copies plugin dashboard files into core and writes a managed .git/info/exclude block", () => {
    const lines: string[] = [];
    const code = materializePlugins({ repoRoot, emit: (l) => lines.push(l) });
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(repoRoot, "dashboard", "app", "ops", "page.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, "dashboard", "lib", "bi-ops.ts"))).toBe(true);
    const exclude = fs.readFileSync(path.join(repoRoot, ".git", "info", "exclude"), "utf-8");
    expect(exclude).toContain(EXCLUDE_BEGIN);
    expect(exclude).toContain("/dashboard/app/ops");
    expect(exclude).toContain("/dashboard/lib/bi-ops.ts");
  });

  it("refuses to clobber a git-tracked core path", () => {
    // core already tracks dashboard/lib/bi-ops.ts
    const tracked = path.join(repoRoot, "dashboard", "lib");
    fs.mkdirSync(tracked, { recursive: true });
    fs.writeFileSync(path.join(tracked, "bi-ops.ts"), "core owns this");
    spawnSync("git", ["add", "dashboard/lib/bi-ops.ts"], { cwd: repoRoot });
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "core"], { cwd: repoRoot });

    const lines: string[] = [];
    materializePlugins({ repoRoot, emit: (l) => lines.push(l) });
    expect(fs.readFileSync(path.join(tracked, "bi-ops.ts"), "utf-8")).toBe("core owns this");
    expect(lines.some((l) => l.includes("git-tracked"))).toBe(true);
  });

  it("prunes stale materialised paths on the next run", () => {
    materializePlugins({ repoRoot, emit: () => {} });
    expect(fs.existsSync(path.join(repoRoot, "dashboard", "app", "ops"))).toBe(true);
    // disable the plugin -> next run prunes
    const reg = pluginRegistryPath(home);
    fs.writeFileSync(reg, JSON.stringify({ plugins: [{ name: "bi", path: pluginRoot, enabled: false }] }));
    materializePlugins({ repoRoot, emit: () => {} });
    expect(fs.existsSync(path.join(repoRoot, "dashboard", "app", "ops"))).toBe(false);
  });
});
