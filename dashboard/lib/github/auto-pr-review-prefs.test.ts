import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let notesDir: string;
const ORIGINAL_ENV = { ...process.env };

vi.mock("@/lib/notes/dir", () => ({
  getNotesDir: () => notesDir,
}));

const {
  autoPrReviewPrefsFilePath,
  envFlagOn,
  readAutoPrReviewPrefs,
  saveAutoPrReviewPrefs,
} = await import("./auto-pr-review-prefs");

beforeEach(() => {
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-apr-prefs-"));
  process.env = { ...ORIGINAL_ENV };
  delete process.env.DEVHUB_AUTO_PR_REVIEW;
  delete process.env.DEVHUB_AUTO_PR_REVIEW_ALWAYS;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  fs.rmSync(notesDir, { recursive: true, force: true });
});

describe("envFlagOn", () => {
  it("accepts common truthy spellings", () => {
    expect(envFlagOn("1")).toBe(true);
    expect(envFlagOn("true")).toBe(true);
    expect(envFlagOn("YES")).toBe(true);
    expect(envFlagOn("on")).toBe(true);
    expect(envFlagOn("0")).toBe(false);
    expect(envFlagOn("")).toBe(false);
    expect(envFlagOn(undefined)).toBe(false);
  });
});

describe("readAutoPrReviewPrefs", () => {
  it("falls back to env when no prefs file exists", () => {
    process.env.DEVHUB_AUTO_PR_REVIEW = "1";
    process.env.DEVHUB_AUTO_PR_REVIEW_ALWAYS = "true";
    expect(readAutoPrReviewPrefs()).toEqual({
      enabled: true,
      always: true,
      source: "env",
    });
  });

  it("defaults both flags off when env and file are absent", () => {
    expect(readAutoPrReviewPrefs()).toEqual({
      enabled: false,
      always: false,
      source: "env",
    });
  });

  it("prefs win over env once the file exists", async () => {
    process.env.DEVHUB_AUTO_PR_REVIEW = "1";
    process.env.DEVHUB_AUTO_PR_REVIEW_ALWAYS = "1";
    await saveAutoPrReviewPrefs({ enabled: false, always: false });
    expect(readAutoPrReviewPrefs()).toEqual({
      enabled: false,
      always: false,
      source: "prefs",
    });
  });

  it("ignores a corrupt / wrong-version file and uses env", () => {
    process.env.DEVHUB_AUTO_PR_REVIEW = "1";
    const file = autoPrReviewPrefsFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 99, prefs: { enabled: true } }));
    expect(readAutoPrReviewPrefs()).toEqual({
      enabled: true,
      always: false,
      source: "env",
    });
  });
});

describe("saveAutoPrReviewPrefs", () => {
  it("merges a partial patch onto env-derived defaults", async () => {
    process.env.DEVHUB_AUTO_PR_REVIEW = "1";
    process.env.DEVHUB_AUTO_PR_REVIEW_ALWAYS = "0";
    const saved = await saveAutoPrReviewPrefs({ always: true });
    expect(saved).toEqual({ enabled: true, always: true, source: "prefs" });
    const raw = JSON.parse(fs.readFileSync(autoPrReviewPrefsFilePath(), "utf-8"));
    expect(raw).toEqual({
      version: 1,
      prefs: { enabled: true, always: true },
    });
  });

  it("merges onto existing prefs on subsequent saves", async () => {
    await saveAutoPrReviewPrefs({ enabled: true, always: true });
    const saved = await saveAutoPrReviewPrefs({ enabled: false });
    expect(saved).toEqual({ enabled: false, always: true, source: "prefs" });
  });
});
