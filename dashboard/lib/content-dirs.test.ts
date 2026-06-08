import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { getTasksDir, getCollectionsDir, getDocsDir } from "./content-dirs";

const SAVE = { REPO_ROOT: process.env.REPO_ROOT, TASKS_DIR: process.env.TASKS_DIR, COLLECTIONS_DIR: process.env.COLLECTIONS_DIR };

beforeEach(() => {
  process.env.REPO_ROOT = "/repo";
  delete process.env.TASKS_DIR;
  delete process.env.COLLECTIONS_DIR;
});

afterEach(() => {
  for (const [k, v] of Object.entries(SAVE)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("personal content dir resolution", () => {
  it("defaults tasks/collections under REPO_ROOT (back-compat)", () => {
    expect(getTasksDir()).toBe(path.join("/repo", "tasks"));
    expect(getCollectionsDir()).toBe(path.join("/repo", "collections"));
    expect(getDocsDir()).toBe(path.join("/repo", "docs"));
  });

  it("honours TASKS_DIR / COLLECTIONS_DIR overrides", () => {
    process.env.TASKS_DIR = "/elsewhere/tasks";
    process.env.COLLECTIONS_DIR = "/elsewhere/collections";
    expect(getTasksDir()).toBe(path.resolve("/elsewhere/tasks"));
    expect(getCollectionsDir()).toBe(path.resolve("/elsewhere/collections"));
  });
});
