import { describe, expect, it } from "vitest";
import { shouldRemindContentRepo } from "./content-repo-reminder";

const base = { desktop: true, completed: true, dismissed: false, linked: false };
describe("shouldRemindContentRepo", () => {
  it("reminds a finished desktop install that keeps everything local", () => {
    expect(shouldRemindContentRepo(base)).toBe(true);
  });
  it("stays quiet mid-setup, after Not now, once a repo is linked, and outside the desktop app", () => {
    expect(shouldRemindContentRepo({ ...base, completed: false })).toBe(false);
    expect(shouldRemindContentRepo({ ...base, dismissed: true })).toBe(false);
    expect(shouldRemindContentRepo({ ...base, linked: true })).toBe(false);
    expect(shouldRemindContentRepo({ ...base, desktop: false })).toBe(false);
  });
});
