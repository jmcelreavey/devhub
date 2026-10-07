/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { readFullscreenPref, writeFullscreenPref } from "./shared";

const KEY = "devhub.repo-git.fullscreen";

describe("git dialog fullscreen preference", () => {
  afterEach(() => {
    window.localStorage.removeItem(KEY);
  });

  it("covers the screen unless the user chose the smaller dialog", () => {
    window.localStorage.removeItem(KEY);
    expect(readFullscreenPref()).toBe(true);
    writeFullscreenPref(false);
    expect(readFullscreenPref()).toBe(false);
    writeFullscreenPref(true);
    expect(readFullscreenPref()).toBe(true);
  });
});
