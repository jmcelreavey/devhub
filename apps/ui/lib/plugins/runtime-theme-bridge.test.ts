import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { themeSurfaceMessage, themeSurfaceDocument } from "./runtime-theme-bridge";
import { parseRuntimeThemes, runtimeThemeBootstrap, runtimeThemeCss } from "./runtime-theme-client";
import { publicRuntimeThemeSchema } from "../../../../packages/shared/ui-lib/plugins/runtime-theme-contract";
import { themePaletteTokens } from "../../../../packages/shared/ui-lib/plugins/theme-palette-schema";
import { hollowBrandAssetUrl } from "../themes/brand-mark";

const theme = publicRuntimeThemeSchema.parse({
  id: "fixture-theme", plugin: "fixture", revision: "a".repeat(64), label: "</script><script>attack()</script>", description: "Fixture",
  dark: Object.fromEntries(themePaletteTokens.map(token => [token, "#112233"])),
  light: Object.fromEntries(themePaletteTokens.map(token => [token, "#ddeeff"])),
  effects: { title: "Fixture", description: "Fixture", mark: "brand", taskMessage: "Done", mergeMessage: "Merged", effects: [{ id: "sound", label: "Sound", description: "Optional", default: false, group: "Extras", reducedMotion: "unchanged" }] },
  audio: [{ id: "hum", volume: 0.1, loop: true, trigger: "ambient", asset: { path: "hum.wav", sha256: "b".repeat(64) } }],
});
const nonce = "8e114698-a463-4aa5-a9dd-1c13a9f9d900";

describe("runtime theme browser boundary", () => {
  it("accepts only declared sound operations from this opaque frame and nonce", () => {
    const frame = {} as MessageEventSource;
    const message = { type: "devhub:theme-audio", nonce, id: "hum", action: "play" };
    const event = { source: frame, origin: "null", data: message };
    expect(themeSurfaceMessage(event, frame, nonce, theme)).toMatchObject({ type: "devhub:theme-audio", id: "hum" });
    for (const patch of [{ source: {} as MessageEventSource }, { origin: "http://localhost:1437" }, { data: { ...message, nonce: "0".repeat(36) } }, { data: { ...message, id: "unknown" } }, { data: { ...message, action: "fetch" } }, { data: { ...message, url: "/api/tasks" } }, { data: null }]) {
      expect(themeSurfaceMessage({ ...event, ...patch }, frame, nonce, theme)).toBeNull();
    }
    expect(themeSurfaceMessage(event, null, nonce, theme)).toBeNull();
    expect(themeSurfaceMessage({ ...event, data: { type: "devhub:theme-error", nonce } }, frame, nonce, theme)).toMatchObject({ type: "devhub:theme-error" });
    expect(themeSurfaceMessage({ ...event, data: { type: "devhub:theme-error", nonce, stack: "private" } }, frame, nonce, theme)).toBeNull();
  });

  it("escapes first-paint metadata and scopes palette and font CSS to a revision", () => {
    const script = runtimeThemeBootstrap([theme]);
    expect(script).not.toContain("</script>");
    const attributes = new Map<string, string>();
    const browser = { window: {}, localStorage: { getItem: () => theme.id }, document: { documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) } } };
    vm.runInNewContext(script, browser);
    expect(attributes.get("data-theme-preset")).toBe(theme.id);
    expect(attributes.get("data-runtime-theme")).toBe(`${theme.revision}:${theme.id}`);
    const css = runtimeThemeCss([theme]);
    expect(css).toContain(`data-runtime-theme="${theme.revision}:${theme.id}"`);
    expect(css).not.toContain("attack");
    expect(parseRuntimeThemes([theme])).toEqual([theme]);
    expect(() => parseRuntimeThemes([theme, theme])).toThrow(/Ambiguous/);
    expect(() => parseRuntimeThemes([{ ...theme, css: "body{display:none}" }])).toThrow();
  });

  it("uses only declared, revision-scoped Hollow mark assets before first paint", () => {
    const hollow = publicRuntimeThemeSchema.parse({ ...theme, id: "hollow", logo: { path: "dark.png", sha256: "c".repeat(64) }, images: [{ id: "brand-light", asset: { path: "light.png", sha256: "d".repeat(64) } }] });
    const dark = hollowBrandAssetUrl(hollow, "dark");
    const light = hollowBrandAssetUrl(hollow, "light");
    expect(dark).toContain("asset=logo");
    expect(light).toContain("asset=image%3Abrand-light");
    const css = runtimeThemeCss([hollow]);
    expect(css).toContain(`data-theme="dark"]{${Object.entries(hollow.dark).map(([token, colour]) => `--${token}:${colour};`).join("")}--hollow-brand-image:url("${dark}");`);
    expect(css).toContain(`--hollow-brand-image:url("${light}");`);
    expect(hollowBrandAssetUrl({ ...hollow, images: [] }, "light")).toBe(dark);
    expect(hollowBrandAssetUrl(theme, "light")).toBeUndefined();
  });

  it("gives the effect surface no dashboard API, media, nested frame or worker permission", () => {
    const document = themeSurfaceDocument("<p>Fixture</p>", nonce);
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain("media-src 'none'");
    expect(document).toContain("frame-src 'none'");
    expect(document).toContain("worker-src 'none'");
    expect(document).toContain("base-uri 'none'");
    expect(document).toContain("form-action 'none'");
    expect(document).toContain("img-src data:;");
    expect(document).not.toContain("devhub:api");
  });
});
