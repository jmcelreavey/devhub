import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSetupProgress, saveSetupProgress } from "./first-run";
import { SaveSetupProgressSchema } from "./progress";

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-first-run-"));
  vi.stubEnv("DEVHUB_APP_DATA", directory);
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
});
