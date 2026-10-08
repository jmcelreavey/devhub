import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getThemeBootstrapInlineScript } from "@/lib/theme-presets";
import {
  HOLLOW_CONTENT_VEIL,
  HOLLOW_EFFECTS_KEY,
  HOLLOW_EFFECT_DEFAULTS,
  HOLLOW_PRESET_ID,
  advanceBoo,
  applyHollowDom,
  getHollowAttributeBootstrapScript,
  hollowDataFlags,
  hollowMotionAllowed,
  hollowRuntimePlan,
  isHollowFaceShot,
  isHollowPreview,
  parseHollowEffects,
  parseHollowNow,
  readHollowEffects,
  shouldMountHollowRuntime,
  writeHollowEffects,
} from "@/lib/hollow-theme";

const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
const hollowCss = fs.readFileSync(path.join(process.cwd(), "app/hollow.css"), "utf8");

function tokenFor(mode: "dark" | "light", token: string): string {
  const selector = new RegExp(
    `:root\\[data-theme="${mode}"\\]\\[data-theme-preset="hollow"\\][^{]*\\{([^}]*)\\}`,
  );
  const block = css.match(selector);
  if (!block) throw new Error(`missing ${mode} hollow block`);
  const found = block[1].match(new RegExp(`${token}:\\s*([^;]+);`));
  if (!found) throw new Error(`missing ${token} in ${mode}`);
  return found[1].trim();
}

function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a: string, b: string): number {
  const light = luminance(a);
  const dark = luminance(b);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
}

/** Black veil in front of both colours — the pessimistic content-well model. */
function veiled(hex: string, alpha: number, light = 0): string {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  const mixed = channels.map((channel) => Math.round(channel * (1 - alpha) + light * alpha));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

describe("hollow effects state", () => {
  it("defaults atmosphere on and jump scares plus sound off", () => {
    expect(HOLLOW_EFFECT_DEFAULTS).toEqual({
      master: true,
      atmosphere: true,
      creatures: true,
      interaction: true,
      rareEvents: true,
      jumpScares: false,
      sound: false,
    });
    expect(parseHollowEffects(null)).toEqual(HOLLOW_EFFECT_DEFAULTS);
    expect(parseHollowEffects("not json")).toEqual(HOLLOW_EFFECT_DEFAULTS);
  });

  it("round-trips through storage and keeps explicit offs", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mem.set(key, value);
      },
    };
    writeHollowEffects(storage, { ...HOLLOW_EFFECT_DEFAULTS, master: false, sound: true });
    expect(storage.getItem(HOLLOW_EFFECTS_KEY)).toContain('"sound":true');
    expect(readHollowEffects(storage)).toMatchObject({ master: false, sound: true, jumpScares: false });
  });

  it("requires Atmosphere, Creatures and motion for rare events, including old saved preferences", () => {
    expect(parseHollowEffects('{"atmosphere":true,"creatures":true}').rareEvents).toBe(true);
    expect(parseHollowEffects('{"rareEvents":false}').rareEvents).toBe(false);
    expect(hollowRuntimePlan(HOLLOW_EFFECT_DEFAULTS, true).rareEvents).toBe(true);
    for (const key of ["master", "atmosphere", "creatures", "rareEvents"] as const) {
      expect(hollowRuntimePlan({ ...HOLLOW_EFFECT_DEFAULTS, [key]: false }, true).rareEvents).toBe(false);
    }
  });

  it("forces every layer off when the master switch is off", () => {
    const flags = hollowDataFlags({ ...HOLLOW_EFFECT_DEFAULTS, master: false, jumpScares: true });
    expect(flags["data-hollow-fx"]).toBe("off");
    expect(flags["data-hollow-atmosphere"]).toBe("off");
    expect(flags["data-hollow-jump"]).toBe("off");
    expect(flags["data-hollow-sound"]).toBe("off");
  });

  it("does not mount the runtime for another preset", () => {
    expect(shouldMountHollowRuntime("graphite", HOLLOW_EFFECT_DEFAULTS, true)).toBe(false);
    expect(shouldMountHollowRuntime(HOLLOW_PRESET_ID, { ...HOLLOW_EFFECT_DEFAULTS, master: false }, true)).toBe(
      false,
    );
    expect(shouldMountHollowRuntime(HOLLOW_PRESET_ID, HOLLOW_EFFECT_DEFAULTS, true)).toBe(true);
  });

  it("drops motion, creatures, glitch and jump scares when motion is disallowed", () => {
    expect(hollowMotionAllowed(true, false)).toBe(false);
    expect(hollowMotionAllowed(false, true)).toBe(false);
    expect(hollowMotionAllowed(false, false)).toBe(true);
    const plan = hollowRuntimePlan(
      { ...HOLLOW_EFFECT_DEFAULTS, jumpScares: true, sound: true },
      false,
    );
    expect(plan.grain).toBe(true);
    expect(plan.grainMotion).toBe(false);
    expect(plan.creatures).toBe(false);
    expect(plan.glitch).toBe(false);
    expect(plan.cursorTrail).toBe(false);
    expect(plan.buttonGlow).toBe(false);
    expect(plan.jumpScares).toBe(false);
    expect(plan.rareEvents).toBe(false);
    expect(plan.cracks).toBe(true);
    expect(plan.sound).toBe(true);
  });

  it("strips hollow attributes when another preset is active", () => {
    const root = {
      attrs: new Map<string, string>([["data-hollow-fx", "on"]]),
      setAttribute(name: string, value: string) {
        this.attrs.set(name, value);
      },
      removeAttribute(name: string) {
        this.attrs.delete(name);
      },
    };
    applyHollowDom(root as unknown as HTMLElement, "tokyo", HOLLOW_EFFECT_DEFAULTS, true);
    expect(root.attrs.size).toBe(0);
    applyHollowDom(root as unknown as HTMLElement, HOLLOW_PRESET_ID, HOLLOW_EFFECT_DEFAULTS, false);
    expect(root.attrs.get("data-hollow-fx")).toBe("on");
    expect(root.attrs.get("data-hollow-jump")).toBe("off");
    expect(root.attrs.get("data-hollow-sound")).toBe("off");
    expect(root.attrs.has("data-hollow-preview")).toBe(false);
  });
});

describe("hollow preview and triggers", () => {

  it("reads an injectable local date", () => {
    const fallback = new Date(2026, 0, 2);
    expect(parseHollowNow("?hollowNow=2026-10-25", fallback)).toEqual(new Date(2026, 9, 25));
    expect(parseHollowNow("?hollowNow=2026-02-31", fallback)).toEqual(fallback);
    expect(isHollowPreview("?hollowPreview=1", null)).toBe(true);
    expect(isHollowPreview("", "1")).toBe(true);
    expect(isHollowPreview("", null)).toBe(false);
    expect(isHollowFaceShot("?hollowFace=1")).toBe(true);
    expect(isHollowFaceShot("?hollowPreview=1")).toBe(false);
  });

  it("completes the word boo and restarts on a stray letter", () => {
    expect(advanceBoo(0, "b")).toBe(1);
    expect(advanceBoo(1, "o")).toBe(2);
    expect(advanceBoo(2, "o")).toBe("trigger");
    expect(advanceBoo(1, "b")).toBe(1);
    expect(advanceBoo(2, "x")).toBe(0);
  });

  it("bakes hollow attribute defaults into the pre-paint script", () => {
    const script = getHollowAttributeBootstrapScript();
    expect(getThemeBootstrapInlineScript()).toContain(script);
    expect(script).toContain("data-hollow-fx");
    expect(script).toContain("removeAttribute");
    expect(script).toContain("on(fx.jumpScares,false)");
    expect(script).toContain("on(fx.sound,false)");
    expect(script).toContain("on(fx.atmosphere,true)");
  });
});

describe("hollow contrast", () => {
  const backgrounds = ["--bg", "--bg-sidebar", "--bg-surface", "--bg-elevated", "--bg-overlay"] as const;
  const foregrounds = ["--text", "--text-muted", "--text-subtle", "--accent-text", "--accent-text-hover", "--success", "--warning", "--danger"] as const;

  it.each(["dark", "light"] as const)("%s text stays at 4.5:1 with the content veil on", (mode) => {
    for (const alpha of [0, HOLLOW_CONTENT_VEIL / 2, HOLLOW_CONTENT_VEIL]) for (const light of [0, 255]) for (const foreground of foregrounds) {
      for (const background of backgrounds) {
        const fg = veiled(tokenFor(mode, foreground), alpha, light);
        const bg = veiled(tokenFor(mode, background), alpha, light);
        expect(contrast(fg, bg), `${mode} ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const light of [0, 255]) for (const background of ["--accent", "--accent-hover"] as const) {
      const ratio = contrast(
        veiled(tokenFor(mode, "--accent-fg"), HOLLOW_CONTENT_VEIL, light),
        veiled(tokenFor(mode, background), HOLLOW_CONTENT_VEIL, light),
      );
      expect(ratio, `${mode} accent-fg on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(["dark", "light"] as const)("%s keeps AA at the rare-event peak, including a pessimistic unmasked edge", (mode) => {
    const preview = hollowCss.match(/\.hollow-fx\.is-rare-preview \.hollow-rare-dim\s*\{([^}]+)\}/)?.[1];
    const peak = Number(preview?.match(/opacity:\s*([\d.]+)/)?.[1]);
    expect(peak).toBe(.85);
    expect(hollowCss).toMatch(/30%, 60% \{ opacity: \.85;/);
    // Runtime coverage tests require zero exposure at all four corners of
    // each readable box. Even just outside the mask, dim + key light remain
    // inside one composite, never an extra veil over the 18% atmosphere.
    for (const alpha of [0, HOLLOW_CONTENT_VEIL * peak, HOLLOW_CONTENT_VEIL]) {
      for (const light of [0, 255]) for (const foreground of foregrounds) for (const background of backgrounds) {
        expect(contrast(veiled(tokenFor(mode, foreground), alpha, light), veiled(tokenFor(mode, background), alpha, light)),
          `${mode} rare-event peak: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    const dim = hollowCss.match(/\.hollow-atmosphere > \.hollow-rare-dim\s*\{([^}]+)\}/)?.[1];
    expect(dim).toContain("ellipse farthest-side at 50% 50%, transparent 60%");
  });

  it("keeps the composited atmosphere within the tested veil budget", () => {
    const atmosphere = hollowCss.match(/\.hollow-atmosphere\s*\{([^}]+)\}/)?.[1];
    expect(Number(atmosphere?.match(/opacity:\s*([\d.]+)/)?.[1])).toBe(HOLLOW_CONTENT_VEIL);
  });
});

describe("hollow stylesheet scope", () => {
  it("keeps mist viewport-sized and stationary, without backdrop filtering or pale fog", () => {
    const envelope = hollowCss.match(/\.hollow-room-mist\s*\{([^}]+)\}/)?.[1];
    expect(envelope).toContain("inset: 0");
    expect(envelope).not.toMatch(/transform|animation|width|height/);
    for (const match of hollowCss.matchAll(/(?:\.hollow-room-backlight|\.hollow-room-mist > \.hollow-fog(?:-near|-mid)?)\s*\{([^}]+)\}/g)) {
      for (const colour of match[1].matchAll(/#([\da-f]{6})(?:[\da-f]{2})?\b/gi)) {
        expect(luminance(`#${colour[1]}`), "room fog must stay close to the dark background").toBeLessThan(.11);
      }
    }
    for (const match of hollowCss.matchAll(/backdrop-filter:\s*([^;]+);/g)) expect(match[1]).toBe("none");
  });

  it("scopes every rule to the preset and keeps motion inside no-preference", () => {
    const noComments = hollowCss.replace(/\/\*[\s\S]*?\*\//g, "");
    const noKeyframes = stripKeyframes(noComments);
    expect(noKeyframes.includes("@keyframes")).toBe(false);

    let index = 0;
    while (index < noKeyframes.length) {
      const open = noKeyframes.indexOf("{", index);
      if (open === -1) break;
      const previousBreak = Math.max(noKeyframes.lastIndexOf("}", open), noKeyframes.lastIndexOf("{", open - 1));
      const selector = noKeyframes.slice(previousBreak + 1, open).trim();
      if (selector && !selector.startsWith("@media") && !selector.startsWith("@supports")) {
        expect(selector, selector).toContain('data-theme-preset="hollow"');
      }
      index = open + 1;
    }

    const motionMedia = mediaSpans(noComments, "(prefers-reduced-motion: no-preference)");
    const animation = /animation\s*:\s*([^;]+);/g;
    let match: RegExpExecArray | null;
    while ((match = animation.exec(noComments))) {
      if (/^none(?:\s+!important)?$/.test(match[1].trim())) continue;
      const inside = motionMedia.some(([start, end]) => match!.index > start && match!.index < end);
      expect(inside, match[0]).toBe(true);
    }
  });
});

function stripKeyframes(css: string): string {
  let result = "";
  let index = 0;
  while (index < css.length) {
    const at = css.indexOf("@keyframes", index);
    if (at === -1) {
      result += css.slice(index);
      break;
    }
    result += css.slice(index, at);
    const open = css.indexOf("{", at);
    let depth = 0;
    let cursor = open;
    for (; cursor < css.length; cursor++) {
      if (css[cursor] === "{") depth++;
      else if (css[cursor] === "}") {
        depth--;
        if (depth === 0) {
          cursor++;
          break;
        }
      }
    }
    index = cursor;
  }
  return result;
}

function mediaSpans(css: string, query: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let from = 0;
  while (from < css.length) {
    const at = css.indexOf("@media", from);
    if (at === -1) break;
    const open = css.indexOf("{", at);
    const header = css.slice(at, open);
    let depth = 0;
    let cursor = open;
    for (; cursor < css.length; cursor++) {
      if (css[cursor] === "{") depth++;
      else if (css[cursor] === "}") {
        depth--;
        if (depth === 0) {
          cursor++;
          break;
        }
      }
    }
    if (header.includes(query)) spans.push([at, cursor]);
    from = cursor;
  }
  return spans;
}
