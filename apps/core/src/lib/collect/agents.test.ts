import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { collectAgents } from "./agents";

let temporaryRoot: string | undefined;

afterEach(() => {
  vi.unstubAllEnvs();
  if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

it("reports a Git staging failure without losing the collected agent", async () => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-collect-agent-"));
  const repo = path.join(temporaryRoot, "repo");
  const home = path.join(temporaryRoot, "home");
  fs.mkdirSync(repo);
  fs.mkdirSync(path.join(home, ".claude", "agents"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "agents", "example.md"), "# Example\n");
  vi.stubEnv("HOME", home);
  vi.stubEnv("GIT_CONFIG_GLOBAL", os.devNull);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "pipe" });
  fs.writeFileSync(path.join(repo, ".git", "index.lock"), "held");

  const output: string[] = [];
  const result = await collectAgents({ repoRoot: repo, emit: (line) => output.push(line) });

  expect(result).toBe(1);
  expect(output.join("\n")).toMatch(/FAILED: example/);
  expect(fs.readFileSync(path.join(repo, "agents", "shared", "example.md"), "utf8")).toContain("Example");
});
