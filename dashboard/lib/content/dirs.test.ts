import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import { getRepoRoot, getTasksDir, getCollectionsDir, getDocsDir, getUpstartsDir } from "@/lib/content/dirs";

const SAVE = {
  REPO_ROOT: process.env.REPO_ROOT,
  TASKS_DIR: process.env.TASKS_DIR,
  COLLECTIONS_DIR: process.env.COLLECTIONS_DIR,
  DOCS_DIR: process.env.DOCS_DIR,
  UPSTARTS_DIR: process.env.UPSTARTS_DIR,
};

beforeEach(() => {
  process.env.REPO_ROOT = "/repo";
  // Clear all dir overrides so the test is hermetic — CI sets DOCS_DIR (see verify.yml),
  // which would otherwise shadow the REPO_ROOT default below.
  delete process.env.TASKS_DIR;
  delete process.env.COLLECTIONS_DIR;
  delete process.env.DOCS_DIR;
  delete process.env.UPSTARTS_DIR;
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(SAVE)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("personal content dir resolution", () => {
  it("uses the private mirror as desktop content root only when explicitly selected", () => {
    vi.stubEnv("DEVHUB_DESKTOP", "1");
    vi.stubEnv("DEVHUB_APP_DATA", "/app-data");
    vi.stubEnv("DEVHUB_CONTENT_ROOT", "");
    expect(getRepoRoot()).toBe("/app-data");
    vi.stubEnv("DEVHUB_CONTENT_ROOT", "/private-mirror");
    expect(getRepoRoot()).toBe("/private-mirror");
    expect(getTasksDir()).toBe("/private-mirror/tasks");
  });
  it("defaults tasks/collections/upstarts under REPO_ROOT (back-compat)", () => {
    expect(getTasksDir()).toBe(path.join("/repo", "tasks"));
    expect(getCollectionsDir()).toBe(path.join("/repo", "collections"));
    expect(getDocsDir()).toBe(path.join("/repo", "docs"));
    expect(getUpstartsDir()).toBe(path.join("/repo", "upstarts"));
  });

  it("honours TASKS_DIR / COLLECTIONS_DIR / UPSTARTS_DIR overrides", () => {
    process.env.TASKS_DIR = "/elsewhere/tasks";
    process.env.COLLECTIONS_DIR = "/elsewhere/collections";
    process.env.UPSTARTS_DIR = "/elsewhere/upstarts";
    expect(getTasksDir()).toBe(path.resolve("/elsewhere/tasks"));
    expect(getCollectionsDir()).toBe(path.resolve("/elsewhere/collections"));
    expect(getUpstartsDir()).toBe(path.resolve("/elsewhere/upstarts"));
  });
});
