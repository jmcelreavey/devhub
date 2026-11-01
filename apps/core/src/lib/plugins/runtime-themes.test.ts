import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pluginContext } from "./context";
import { prepareLocal, confirmOperation, startLifecycle } from "./operations";
import { readManifest } from "./manifest";
import { hashFile } from "./inspect";
import { loadRuntime } from "./runtime-host";
import { runtimeSchema } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import { runtimeThemeAssets, runtimeThemeAssetUrl, runtimeThemeSchema } from "../../../../../packages/shared/ui-lib/plugins/runtime-theme-contract";
import { verifyThemeAsset } from "./runtime-theme-files";
import { runtimeThemeAsset, runtimeThemeCatalog, runtimeThemeSnapshot } from "./runtime-themes";
import { themePaletteSchema } from "../../../../../packages/shared/ui-lib/plugins/theme-palette-schema";
import type { PluginOperationView } from "../../../../../packages/shared/ui-lib/plugins/model";

const roots: string[] = [];
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const palette = themePaletteSchema.parse(Object.fromEntries(themePaletteSchema.keyType.options.map(key => [key, "#112233"])));
const effects = { title: "Fixture effects", description: "A reviewed fixture", mark: "brand", taskMessage: "Done", mergeMessage: "Merged", effects: [{ id: "sound", label: "Sound", description: "Starts after a click", default: false, group: "Extras", reducedMotion: "unchanged" }] };

function consent(view: PluginOperationView) {
  if (!view.preview) throw new Error("Missing preview");
  return { accepted: true, revision: view.preview.revision, planDigest: view.preview.planDigest, selectedTargets: [] };
}
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-themes-")));
  roots.push(root);
  const source = path.join(root, "source");
  fs.cpSync(path.resolve("../../templates/runtime-plugin"), source, { recursive: true });
  fs.writeFileSync(path.join(source, "effect.html"), "<p>Reviewed effect fixture</p>");
  fs.writeFileSync(path.join(source, "static.png"), pixel);
  const parsed = readManifest(source);
  if (!parsed.ok || !parsed.manifest.runtime) throw new Error("Invalid fixture");
  const manifest = parsed.manifest;
  const theme = runtimeThemeSchema.parse({ id: "fixture-theme", label: "Fixture theme", description: "Fixture palette", dark: palette, light: palette, effects,
    surface: { path: "effect.html", sha256: hashFile(path.join(source, "effect.html")) }, staticImage: { path: "static.png", sha256: hashFile(path.join(source, "static.png")) },
  });
  manifest.runtime!.capabilities = { themes: [theme] };
  const save = () => fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
  save();
  const ctx = pluginContext({ home: root, repoRoot: path.join(root, "core"), env: { NODE_ENV: "test", DEVHUB_CONFIG_DIR: path.join(root, "config"), DEVHUB_PLUGIN_HOME: path.join(root, "managed"), DEVHUB_PLUGIN_TARGET_HOME: path.join(root, "targets") } });
  const install = async () => {
    const review = await prepareLocal(ctx, source);
    expect(review.preview?.canApply).toBe(true);
    expect((await confirmOperation(ctx, review.id, consent(review))).state).toBe("succeeded");
  };
  return { root, source, ctx, manifest, theme, save, install };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("reviewed runtime themes", () => {
  it("reviews palette, effect and asset declarations without making source imports", async () => {
    const { ctx, source, install, theme } = fixture();
    expect(runtimeThemeCatalog(ctx)).toEqual([]);
    const review = await prepareLocal(ctx, source);
    expect(review.preview?.inventory.find(group => group.kind === "Runtime themes")?.entries.join(" ")).toContain("fixture-theme");
    await install();
    const [active] = runtimeThemeCatalog(ctx);
    expect(active).toMatchObject({ ...theme, plugin: "sample-tools" });
    expect(active.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(runtimeThemeAssetUrl(active, "surface")).toContain(`revision=${active.revision}`);
    expect(runtimeThemeAsset(ctx, active.plugin, active.id, active.revision, "surface").bytes.toString()).toContain("Reviewed effect fixture");
    expect(runtimeThemeAsset(ctx, active.plugin, active.id, active.revision, "static").mime).toBe("image/png");
  });

  it("denies undeclared assets, traversal, stale revisions and disabled plugins", async () => {
    const { ctx, install } = fixture();
    await install();
    const [theme] = runtimeThemeCatalog(ctx);
    for (const id of ["worker.mjs", "../worker.mjs", "font", "audio:unknown"]) expect(() => runtimeThemeAsset(ctx, theme.plugin, theme.id, theme.revision, id)).toThrow(/unavailable/);
    expect(() => runtimeThemeAsset(ctx, theme.plugin, theme.id, "0".repeat(64), "surface")).toThrow(/unavailable/);
    const disabled = await startLifecycle(ctx, theme.plugin, "disable");
    await confirmOperation(ctx, disabled.id, consent(disabled));
    expect(runtimeThemeCatalog(ctx)).toEqual([]);
    expect(runtimeThemeSnapshot(ctx).managedPlugins).toContain(theme.plugin);
    expect(() => runtimeThemeAsset(ctx, theme.plugin, theme.id, theme.revision, "surface")).toThrow();
    const enabled = await startLifecycle(ctx, theme.plugin, "enable");
    await confirmOperation(ctx, enabled.id, consent(enabled));
    expect(runtimeThemeCatalog(ctx)[0].revision).toBe(theme.revision);
  });

  it("invalidates modified snapshots before exposing their assets", async () => {
    const { ctx, install } = fixture();
    await install();
    const [theme] = runtimeThemeCatalog(ctx);
    fs.appendFileSync(path.join(loadRuntime(ctx, theme.plugin).root, "effect.html"), "changed");
    expect(runtimeThemeCatalog(ctx)).toEqual([]);
    expect(() => runtimeThemeAsset(ctx, theme.plugin, theme.id, theme.revision, "surface")).toThrow();
  });

  it("hides both owners of an ambiguous preset instead of choosing by registry order", async () => {
    const { ctx, manifest, save, install } = fixture();
    await install();
    manifest.name = "second-theme";
    save();
    await install();
    expect(runtimeThemeCatalog(ctx)).toEqual([]);
  });

  it("refuses wrong hashes and executable files disguised as inert assets during review", async () => {
    const { ctx, source, theme, save } = fixture();
    theme.staticImage!.sha256 = "0".repeat(64);
    save();
    expect((await prepareLocal(ctx, source)).preview?.canApply).toBe(false);
    fs.writeFileSync(path.join(source, "static.png"), "<script>not an image</script>");
    theme.staticImage!.sha256 = hashFile(path.join(source, "static.png"));
    save();
    expect((await prepareLocal(ctx, source)).preview?.canApply).toBe(false);
  });

  it("rejects reserved IDs, CSS injection, path escapes, unknown effects fields and automatic audio consent", () => {
    const { manifest, theme } = fixture();
    for (const patch of [{ id: "graphite" }, { id: "constructor" }, { css: "body{display:none}" }, { dark: { ...palette, bg: "url(https://example.test)" } }, { surface: { path: "../effect.html", sha256: "0".repeat(64) } }, { effects: { ...effects, script: "alert(1)" } }, { audio: [{ id: "hum", asset: { path: "hum.wav", sha256: "0".repeat(64) }, volume: 0.5, loop: true, trigger: "ambient" }] }]) {
      expect(runtimeThemeSchema.safeParse({ ...theme, ...patch }).success).toBe(false);
    }
    expect(runtimeSchema.safeParse({ ...manifest.runtime, capabilities: { themes: [theme, theme] } }).success).toBe(false);
    const audio = [{ id: "hum", asset: { path: "hum.wav", sha256: "0".repeat(64) }, volume: 0.1, loop: true, trigger: "ambient" as const }];
    expect(runtimeThemeSchema.safeParse({ ...theme, audio, effects: { ...effects, effects: [{ ...effects.effects[0], default: true }] } }).success).toBe(false);
    expect(runtimeThemeAssets({ ...theme, audio }).map(asset => asset.id)).toContain("audio:hum");
  });

  it("validates static layer references and one-shot gesture sounds", () => {
    const { theme } = fixture();
    const declaration = { id: "atmosphere", label: "Atmosphere", description: "A still treatment", default: true, group: "Atmosphere", reducedMotion: "static" };
    const layer = { id: "wash", effect: "atmosphere", placement: "fill", opacity: 1, mobileOpacity: 0.7, asset: theme.staticImage!, light: theme.staticImage! };
    const candidate = { ...theme, staticImage: undefined, effects: { ...effects, effects: [...effects.effects, declaration] }, staticLayers: [layer], layer: "background",
      audio: [{ id: "bell", asset: { path: "bell.wav", sha256: "0".repeat(64) }, volume: 0.1, loop: false, trigger: "gesture" }] };
    const parsed = runtimeThemeSchema.parse(candidate);
    expect(runtimeThemeAssets(parsed).map(asset => asset.id)).toEqual(expect.arrayContaining(["static:wash", "static:wash:light", "audio:bell"]));
    for (const patch of [
      { staticImage: theme.staticImage },
      { staticLayers: [layer, layer] },
      { staticLayers: [{ ...layer, effect: "missing" }] },
      { staticLayers: [{ ...layer, placement: "url(javascript:evil)" }] },
      { staticLayers: [{ ...layer, opacity: 2 }] },
      { staticLayers: [{ ...layer, light: { ...layer.light, path: "../image.png" } }] },
      { audio: [{ ...candidate.audio[0], loop: true }] },
      { hostEffects: ["cursor"] },
    ]) expect(runtimeThemeSchema.safeParse({ ...candidate, ...patch }).success).toBe(false);
    expect(runtimeThemeSchema.safeParse({ ...candidate, effects: { ...candidate.effects, effects: [...effects.effects, { ...declaration, reducedMotion: "off" }] } }).success).toBe(false);
  });

  it("requires the bounded scene and fixed decorations to be explicitly declared", () => {
    const { theme } = fixture();
    const interaction = { id: "interaction", label: "Interaction", description: "Fixed host effects", default: true, group: "Feedback", reducedMotion: "static" };
    const candidate = { ...theme, effects: { ...effects, effects: [...effects.effects, interaction] }, readableScene: true, hostDecorations: { headingGlitch: true, hoverCrack: true } };
    expect(runtimeThemeSchema.safeParse(candidate).success).toBe(true);
    for (const patch of [
      { readableScene: false },
      { surface: undefined },
      { effects: undefined },
      { effects },
      { hostDecorations: { hoverCrack: false } },
      { hostDecorations: { hoverCrack: true, selector: "input" } },
      { readableScene: { selector: "input" } },
    ]) expect(runtimeThemeSchema.safeParse({ ...candidate, ...patch }).success).toBe(false);
    const layer = { id: "room", effect: "interaction", placement: "room", opacity: 1, mobileOpacity: 1, asset: theme.staticImage!, light: theme.staticImage! };
    expect(runtimeThemeSchema.safeParse({ ...candidate, staticImage: undefined, staticLayers: [layer] }).success).toBe(true);
    expect(runtimeThemeSchema.safeParse({ ...candidate, readableScene: undefined, staticImage: undefined, staticLayers: [layer] }).success).toBe(false);
  });

  it("bounds assets and rejects animated or malformed images, invalid UTF-8, fonts and audio", () => {
    expect(() => verifyThemeAsset(pixel, "image")).not.toThrow();
    expect(() => verifyThemeAsset(Buffer.alloc(256 * 1024 + 1), "html")).toThrow(/large/);
    expect(() => verifyThemeAsset(Buffer.from([255]), "html")).toThrow();
    for (const kind of ["image", "font", "audio"] as const) expect(() => verifyThemeAsset(Buffer.from("<script>"), kind)).toThrow(/format/);
    const animated = Buffer.concat([pixel.subarray(0, 33), Buffer.from([0, 0, 0, 0]), Buffer.from("acTL"), Buffer.alloc(4), pixel.subarray(33)]);
    expect(() => verifyThemeAsset(animated, "image")).toThrow(/animated/);
  });
});
