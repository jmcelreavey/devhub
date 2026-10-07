import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planBranding, materializeBranding } from "./branding";
import { pluginRegistryPath } from "./registry";
import type { RegisteredPlugin } from "./types";

function mkBrandingPlugin(rootDir: string): RegisteredPlugin {
  return {
    name: "acme",
    path: rootDir,
    enabled: true,
    manifest: {
      name: "acme",
      version: "1.0.0",
      devhubApi: "1",
      contributes: {},
      branding: {
        themeCss: "branding/theme.css",
        presets: "branding/presets.json",
        defaultPreset: "acme",
        defaultMode: "system",
        fonts: "branding/fonts",
        logo: { src: "branding/logo.svg", label: "ACME" },
        // Deprecated and ignored, but old manifests carry it and must still validate.
        openchamber: { themes: "branding/oc", defaultDarkId: "acme-dark", defaultLightId: "acme-light" },
        desktopIcon: "branding/icon.png",
      },
    },
  };
}

describe("planBranding", () => {
  it("returns no plugin when none declares branding", () => {
    const plan = planBranding([
      { name: "x", path: "/x", enabled: true, manifest: { name: "x", version: "1", devhubApi: "1", contributes: {} } },
    ]);
    expect(plan.plugin).toBeNull();
    expect(plan.branding).toBeNull();
  });

  it("picks the first plugin with branding and warns on conflicts", () => {
    const a = mkBrandingPlugin("/a");
    const b = mkBrandingPlugin("/b");
    b.name = "beta";
    const plan = planBranding([a, b]);
    expect(plan.plugin?.name).toBe("acme");
    expect(plan.errors.some((e) => e.includes("Multiple plugins"))).toBe(true);
  });
});

describe("materializeBranding", () => {
  let home: string;
  let repoRoot: string;
  let pluginRoot: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-home-"));
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-repo-"));
    pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-brand-plugin-"));

    // Core dashboard skeleton + committed empty baselines.
    for (const d of ["app", "lib", "public"]) fs.mkdirSync(path.join(repoRoot, "dashboard", d), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "dashboard", "app", "plugin-branding.generated.css"), "/* empty */\n");
    fs.writeFileSync(path.join(repoRoot, "dashboard", "lib", "plugin-branding.generated.ts"), "export const PLUGIN_THEME_PRESETS = [];\n");

    // Plugin branding fixtures.
    const bdir = path.join(pluginRoot, "branding");
    fs.mkdirSync(path.join(bdir, "fonts"), { recursive: true });
    fs.writeFileSync(path.join(bdir, "theme.css"), ':root[data-theme-preset="acme"]{--accent:#f00;}');
    fs.writeFileSync(path.join(bdir, "presets.json"), JSON.stringify([{ id: "acme", label: "ACME", description: "d", darkSwatch: "#000", lightSwatch: "#fff" }]));
    fs.writeFileSync(path.join(bdir, "logo.svg"), "<svg/>");
    fs.writeFileSync(path.join(bdir, "icon.png"), "PNGDATA");
    fs.writeFileSync(path.join(bdir, "fonts", "Acme.woff2"), "FONT");

    // A real manifest on disk — listEnabledPlugins reads this, not the in-memory object.
    fs.writeFileSync(
      path.join(pluginRoot, "devhub-plugin.json"),
      JSON.stringify(mkBrandingPlugin(pluginRoot).manifest),
    );

    const reg = pluginRegistryPath(home);
    fs.mkdirSync(path.dirname(reg), { recursive: true });
    fs.writeFileSync(reg, JSON.stringify({ plugins: [{ name: "acme", path: pluginRoot, enabled: true }] }));
  });

  afterEach(() => {
    for (const d of [home, repoRoot, pluginRoot]) fs.rmSync(d, { recursive: true, force: true });
  });

  const dashFile = (rel: string) => path.join(repoRoot, "dashboard", rel);

  it("generates theme/css/logo/fonts/electron when a plugin opts in", () => {
    const code = materializeBranding({ repoRoot, home, emit: () => {} });
    expect(code).toBe(0);

    const ts = fs.readFileSync(dashFile("lib/plugin-branding.generated.ts"), "utf8");
    expect(ts).toContain('"id": "acme"');
    expect(ts).toContain('PLUGIN_DEFAULT_PRESET: string | null = "acme"');
    expect(ts).toContain('PLUGIN_DEFAULT_MODE: "dark" | "light" | "system" | null = "system"');
    expect(ts).toMatch(/PLUGIN_BRAND_LOGO.*src: "\/plugin-brand-logo\.svg\?v=/);
    expect(ts).toContain('label: "ACME"');

    expect(fs.readFileSync(dashFile("app/plugin-branding.generated.css"), "utf8")).toContain("--accent:#f00");
    expect(fs.existsSync(dashFile("public/plugin-brand-logo.svg"))).toBe(true);
    expect(fs.existsSync(dashFile("public/plugin-desktop-icon.png"))).toBe(true);
    expect(fs.existsSync(dashFile("public/fonts-plugin/Acme.woff2"))).toBe(true);
  });

  it("restores the empty baseline and prunes assets when no plugin declares branding", () => {
    materializeBranding({ repoRoot, home, emit: () => {} });
    // Disable the plugin.
    fs.writeFileSync(pluginRegistryPath(home), JSON.stringify({ plugins: [] }));
    const code = materializeBranding({ repoRoot, home, emit: () => {} });
    expect(code).toBe(0);
    expect(fs.readFileSync(dashFile("lib/plugin-branding.generated.ts"), "utf8")).toContain("PLUGIN_THEME_PRESETS: ThemePresetMeta[] = []");
    expect(fs.existsSync(dashFile("public/plugin-brand-logo.svg"))).toBe(false);
    expect(fs.existsSync(dashFile("public/fonts-plugin"))).toBe(false);
    expect(fs.existsSync(dashFile("public/plugin-desktop-icon.png"))).toBe(false);
  });
});
