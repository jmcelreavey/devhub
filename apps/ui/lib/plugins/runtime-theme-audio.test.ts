import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runtimeThemeAudio } from "./runtime-theme-audio";
import { replaceRuntimeThemes } from "./runtime-theme-client";
import { publicRuntimeThemeSchema } from "../../../../packages/shared/ui-lib/plugins/runtime-theme-contract";
import { themePaletteTokens } from "../../../../packages/shared/ui-lib/plugins/theme-palette-schema";

const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();
class AudioFixture {
  paused = true;
  currentTime = 0;
  preload = "";
  volume = 0;
  loop = false;
  play = play;
  pause = pause;
  removeAttribute() {}
  load() {}
}
const theme = publicRuntimeThemeSchema.parse({
  id: "fixture-theme", plugin: "sample", revision: "a".repeat(64), label: "Fixture", description: "Audio fixture",
  dark: Object.fromEntries(themePaletteTokens.map(token => [token, "#112233"])),
  light: Object.fromEntries(themePaletteTokens.map(token => [token, "#ddeeff"])),
  effects: { title: "Fixture", description: "Audio fixture", mark: "brand", taskMessage: "Done", mergeMessage: "Merged", effects: [
    { id: "sound", label: "Sound", description: "Sound on activation", group: "Extras", default: false, reducedMotion: "off" },
  ] },
  audio: [{ id: "bell", asset: { path: "bell.wav", sha256: "0".repeat(64) }, volume: 0.1, loop: false, trigger: "gesture" }],
});
const enabled = { master: true, sound: true };
const pointer = (trusted: boolean) => ({ type: "pointerdown", isTrusted: trusted, target: null } as Event);

beforeEach(() => {
  play.mockClear(); pause.mockClear();
  vi.stubGlobal("Audio", AudioFixture);
  vi.stubGlobal("Element", class {});
  vi.stubGlobal("navigator", { userActivation: { isActive: true } });
  vi.stubGlobal("window", new EventTarget());
  replaceRuntimeThemes([theme], [theme.plugin]);
});
afterEach(() => { replaceRuntimeThemes([], []); vi.unstubAllGlobals(); });

describe("runtime gesture audio", () => {
  it("plays once per opt-in only after a trusted activation", () => {
    const audio = runtimeThemeAudio(theme, vi.fn());
    audio.configure({ master: true, sound: false }, true, true);
    audio.gesture(pointer(true));
    audio.configure(enabled, true, true);
    audio.gesture(pointer(false));
    audio.request("bell", "play");
    expect(play).not.toHaveBeenCalled();
    audio.gesture(pointer(true));
    audio.gesture(pointer(true));
    audio.configure(enabled, true, true);
    audio.request("bell", "play");
    expect(play).toHaveBeenCalledTimes(1);
    audio.configure({ master: true, sound: false }, true, true);
    expect(pause).toHaveBeenCalled();
    audio.configure(enabled, true, true, true);
    expect(play).toHaveBeenCalledTimes(2);
    audio.configure(enabled, true, false);
    audio.configure(enabled, true, true);
    expect(play).toHaveBeenCalledTimes(2);
    audio.gesture(pointer(true));
    expect(play).toHaveBeenCalledTimes(3);
    audio.dispose();
  });

  it("keeps ambient sounds gated by the first trusted gesture", () => {
    const ambientTheme = { ...theme, audio: [{ ...theme.audio![0], trigger: "ambient" as const, loop: true }] };
    const audio = runtimeThemeAudio(ambientTheme, vi.fn());
    audio.configure(enabled, true, true);
    audio.gesture(pointer(false));
    expect(play).not.toHaveBeenCalled();
    audio.gesture(pointer(true));
    expect(play).toHaveBeenCalledTimes(1);
    audio.request("bell", "stop");
    expect(pause).toHaveBeenCalled();
    audio.dispose();
  });
});
