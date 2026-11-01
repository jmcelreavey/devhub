import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { resolveRepoPath } from "./learn-resolve";

const fixtures: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const fixture of fixtures.splice(0)) fs.rmSync(fixture, { recursive: true, force: true });
});

it("opens learning for a spaced repo name without accepting paths outside the scan root", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "learn-resolve-"));
  fixtures.push(fixture);
  const scanDir = path.join(fixture, "repos");
  const repoPath = path.join(scanDir, "fixture repo");
  fs.mkdirSync(path.join(repoPath, ".git"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "outside", ".git"), { recursive: true });
  vi.stubEnv("DEVHUB_REPOS_DIR", scanDir);

  expect(resolveRepoPath("fixture repo")).toBe(repoPath);
  for (const name of ["../outside", "..\\outside", "fixture repo/..", "missing"])
    expect(resolveRepoPath(name)).toBeNull();
});
