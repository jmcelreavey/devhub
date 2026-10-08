import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTodayViewPref, uiPrefsPath, writeTodayViewPref } from "./view-pref";

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-ui-prefs-"));
  file = path.join(dir, ".config", "devhub", "ui-prefs.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("Today view preference", () => {
  it("lives beside dashboard.json in the user's config folder", () => {
    expect(uiPrefsPath("/home/me")).toBe("/home/me/.config/devhub/ui-prefs.json");
  });
  it("is null until a choice is saved", () => {
    expect(readTodayViewPref(file)).toBeNull();
  });
  it("round-trips, creating the folder, and keeps other preferences", async () => {
    await writeTodayViewPref("focus", file);
    expect(readTodayViewPref(file)).toBe("focus");
    fs.writeFileSync(file, JSON.stringify({ todayView: "focus", other: 1 }));
    await writeTodayViewPref("dashboard", file);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ todayView: "dashboard", other: 1 });
  });
  it("ignores a value it does not recognise", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ todayView: "wide" }));
    expect(readTodayViewPref(file)).toBeNull();
  });
});
