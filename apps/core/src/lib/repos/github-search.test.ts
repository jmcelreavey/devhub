import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { listGithubRepos } from "./index";

const fixtures: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const fixture of fixtures.splice(0)) fs.rmSync(fixture, { recursive: true, force: true });
});

it("searches GitHub without enumerating every accessible repo and refreshes local matches", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-github-search-"));
  fixtures.push(fixture);
  const bin = path.join(fixture, "bin");
  const scanDir = path.join(fixture, "repos");
  const localRepo = path.join(scanDir, "local-spriteforge");
  const calls = path.join(fixture, "calls");
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(localRepo, ".git"), { recursive: true });
  fs.writeFileSync(path.join(localRepo, ".git", "config"), "[remote \"origin\"]\n  url = https://github.com/fixture/spriteforge.git\n");
  fs.writeFileSync(path.join(bin, "gh"), `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.GH_FIXTURE_CALLS, process.argv.slice(2).join(" ") + "\\n");
if (process.argv.includes("--paginate")) process.exit(71);
console.log(JSON.stringify({ name: "spriteforge", fullName: "fixture/spriteforge", owner: "fixture", url: "https://github.com/fixture/spriteforge", description: null, isPrivate: true, defaultBranch: "main" }));
`, { mode: 0o755 });
  vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH ?? ""}`);
  vi.stubEnv("DEVHUB_REPOS_DIR", scanDir);
  vi.stubEnv("GH_FIXTURE_CALLS", calls);

  expect(await listGithubRepos(" ")).toEqual([]);
  const [first, concurrent] = await Promise.all([listGithubRepos("spriteforge"), listGithubRepos("spriteforge")]);
  expect(first).toEqual([expect.objectContaining({ fullName: "fixture/spriteforge", localRepoName: "local-spriteforge" })]);
  expect(concurrent).toEqual(first);
  expect(fs.readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
  expect(fs.readFileSync(calls, "utf8")).toContain("search/repositories");
  expect(fs.readFileSync(calls, "utf8")).toContain("fork:true");
  expect(fs.readFileSync(calls, "utf8")).not.toContain("--paginate");

  fs.rmSync(localRepo, { recursive: true });
  expect((await listGithubRepos("spriteforge"))[0].localRepoName).toBeNull();
  expect(fs.readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
});
