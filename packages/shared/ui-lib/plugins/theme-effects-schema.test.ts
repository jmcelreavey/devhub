import { describe, expect, it } from "vitest";
import { pluginThemeEffectsSchema, themePackEffectsSchema, trustedThemePackEffectsSchema } from "./theme-effects-schema.ts";

const effect = { id: "ambient", label: "Light", description: "A still wash.", default: true, group: "Atmosphere", reducedMotion: "static" };
const declaration = { title: "Workshop", description: "Quiet feedback.", mark: "brand", taskMessage: "Done.", mergeMessage: "Merged.", effects: [effect] };

describe("plugin effect metadata", () => {
  it("accepts custom CSS effects and optional direct dependencies", () => {
    expect(pluginThemeEffectsSchema.safeParse({
      ...declaration, effects: [effect, { ...effect, id: "rules", requires: ["ambient"] }],
    }).success).toBe(true);
  });

  it.each([
    { effects: [effect, effect] },
    { effects: [{ ...effect, id: "motion" }] },
    { effects: [{ ...effect, id: "__proto__" }] },
    { effects: [{ ...effect, id: "Bad Attribute" }] },
    { effects: [{ ...effect, default: "true" }] },
    { effects: [{ ...effect, reducedMotion: "ignore" }] },
    { effects: [{ ...effect, requires: ["missing"] }] },
    { effects: [{ ...effect, requires: ["ambient"] }] },
    { effects: [{ ...effect, requires: ["rules"] }, { ...effect, id: "rules", requires: ["ambient"] }] },
    { storageKey: "devhub:theme" },
    { event: "devhub:theme-change" },
    { mark: "javascript:alert(1)" },
  ])("rejects malformed or unsafe declarations: %j", patch => {
    expect(pluginThemeEffectsSchema.safeParse({ ...declaration, ...patch }).success).toBe(false);
  });
});

describe("checkout theme pack effects", () => {
  it("validates interactive effect identifiers and case-insensitive attribute collisions", () => {
    const rare = { ...effect, id: "rareEvents", requires: ["atmosphere"] };
    expect(trustedThemePackEffectsSchema.safeParse({ ...declaration, effects: [{ ...effect, id: "atmosphere" }, rare] }).success).toBe(true);
    expect(trustedThemePackEffectsSchema.safeParse({ ...declaration, effects: [rare, { ...rare, id: "rareevents" }] }).success).toBe(false);
    expect(trustedThemePackEffectsSchema.safeParse({ ...declaration, effects: [{ ...effect, id: "toString" }] }).success).toBe(false);
  });
  it("accepts only host-rendered effects that turn off under reduced motion", () => {
    expect(themePackEffectsSchema.safeParse({
      ...declaration, effects: [{ ...effect, id: "cursor", reducedMotion: "off" }, { ...effect, id: "celebrations", reducedMotion: "off" }],
    }).success).toBe(true);
    expect(themePackEffectsSchema.safeParse({
      ...declaration, effects: [{ ...effect, id: "cursor", reducedMotion: "static" }],
    }).success).toBe(false);
    expect(themePackEffectsSchema.safeParse({
      ...declaration, effects: [{ ...effect, id: "atmosphere", reducedMotion: "off" }],
    }).success).toBe(false);
  });
});
