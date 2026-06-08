import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hasSavedCalendarSelection,
  readCalendarSelection,
  writeCalendarSelection,
} from "./calendar-selection";

let tmpRepo = "";
let originalRepoRoot: string | undefined;

beforeEach(() => {
  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-cal-sel-"));
  originalRepoRoot = process.env.REPO_ROOT;
  process.env.REPO_ROOT = tmpRepo;
});

afterEach(() => {
  if (originalRepoRoot === undefined) delete process.env.REPO_ROOT;
  else process.env.REPO_ROOT = originalRepoRoot;
  fs.rmSync(tmpRepo, { recursive: true, force: true });
});

describe("calendar-selection", () => {
  it("starts empty and reports no saved selection", () => {
    expect(readCalendarSelection()).toEqual([]);
    expect(hasSavedCalendarSelection()).toBe(false);
  });

  it("persists selected calendar IDs", async () => {
    await writeCalendarSelection(["primary", "personal@group.calendar.google.com", "primary"]);
    expect(readCalendarSelection()).toEqual(["primary", "personal@group.calendar.google.com"]);
    expect(hasSavedCalendarSelection()).toBe(true);
  });
});
