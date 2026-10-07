import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSetupProgress, saveSetupProgress } from "./first-run";
import { SaveSetupProgressSchema } from "./progress";
import { shouldRemindContentRepo } from "./content-repo-reminder";

function writeFile(relative: string, content: string) {
  const file = path.join(directory, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-first-run-"));
  vi.stubEnv("DEVHUB_APP_DATA", directory);
  vi.stubEnv("DEVHUB_DESKTOP", "1");
  vi.stubEnv("DEVHUB_ENV_FILE", path.join(directory, "config", ".env.local"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("setup progress", () => {
  it("starts at Welcome and retains the selected step and goals across reads", () => {
    expect(readSetupProgress()).toMatchObject({ completed: false, currentStep: "welcome" });
    saveSetupProgress({ currentStep: "paths", goals: ["code"], skipped: ["tools"] });
    expect(readSetupProgress()).toMatchObject({ currentStep: "paths", goals: ["code"], skipped: ["tools"] });
  });
  it("keeps completion when a later visit changes only the current step", () => {
    saveSetupProgress({ completed: true, currentStep: "done" });
    saveSetupProgress(SaveSetupProgressSchema.parse({ currentStep: "paths" }));
    expect(readSetupProgress()).toMatchObject({ completed: true, currentStep: "paths" });
    expect(readSetupProgress().completedAt).toBeTruthy();
  });
  it("loads older completion records without making a completed install new again", () => {
    fs.mkdirSync(path.join(directory, "config"));
    fs.writeFileSync(path.join(directory, "config", "first-run.json"), JSON.stringify({ completed: true }));
    expect(readSetupProgress()).toMatchObject({ completed: true, currentStep: "welcome" });
  });
  it("rejects an unknown step instead of persisting an unusable wizard", () => {
    expect(SaveSetupProgressSchema.safeParse({ currentStep: "missing" }).success).toBe(false);
  });
  describe("upgrading from a build that never wrote first-run.json", () => {
    it("stays on the wizard for a genuinely empty profile", () => {
      expect(readSetupProgress()).toMatchObject({ completed: false, currentStep: "welcome" });
      expect(fs.existsSync(path.join(directory, "config", "first-run.json"))).toBe(false);
    });
    it("marks a profile with a linked checkout as completed, once", () => {
      writeFile("repo-path.txt", "/home/me/dev/checkout\n");
      expect(readSetupProgress()).toMatchObject({ completed: true, currentStep: "done" });
      expect(fs.existsSync(path.join(directory, "config", "first-run.json"))).toBe(true);
      fs.rmSync(path.join(directory, "repo-path.txt"));
      expect(readSetupProgress().completed).toBe(true);
    });
    it("marks a profile with a linked content repo as completed", () => {
      writeFile("content-repo-path.txt", "/home/me/dev/content");
      expect(readSetupProgress().completed).toBe(true);
    });
    it("marks a profile with saved paths in its env file as completed", () => {
      writeFile("config/.env.local", "# DevHub\nNOTES_DIR=/home/me/notes\n");
      expect(readSetupProgress().completed).toBe(true);
    });
    it("ignores an env file that holds only the Paseo password", () => {
      writeFile("config/.env.local", "DEVHUB_PASEO_PASSWORD=synthetic\n");
      expect(readSetupProgress().completed).toBe(false);
    });
    it("does not migrate outside the desktop runtime", () => {
      vi.stubEnv("DEVHUB_DESKTOP", "");
      writeFile("repo-path.txt", "/home/me/dev/checkout");
      expect(readSetupProgress().completed).toBe(false);
    });
  });

  describe("no fork, no GitHub, no git", () => {
    it("finishes setup with the repo step skipped, then reminds once until dismissed", () => {
      saveSetupProgress({ skipped: ["github"], currentStep: "done" });
      saveSetupProgress(SaveSetupProgressSchema.parse({ completed: true }));
      const done = readSetupProgress();
      expect(done).toMatchObject({ completed: true, skipped: ["github"], contentRepoReminderDismissed: false });
      expect(shouldRemindContentRepo({ desktop: true, completed: done.completed, dismissed: done.contentRepoReminderDismissed, linked: false })).toBe(true);
      saveSetupProgress(SaveSetupProgressSchema.parse({ contentRepoReminderDismissed: true }));
      const dismissed = readSetupProgress();
      expect(dismissed).toMatchObject({ completed: true, contentRepoReminderDismissed: true });
      expect(shouldRemindContentRepo({ desktop: true, completed: true, dismissed: dismissed.contentRepoReminderDismissed, linked: false })).toBe(false);
    });
  });
});
