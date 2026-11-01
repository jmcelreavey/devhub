import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execExternal } from "../../../apps/core/src/lib/exec-external";

const root = path.resolve(import.meta.dirname, "../../..");
const seedScript = path.join(root, "scripts/make-public-seed.sh");
const fixtureDirs: string[] = [];

async function run(file: string, args: string[], cwd: string) {
  return execExternal(file, args, {
    cwd,
    env: { PATH: process.env.PATH, HOME: cwd, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    timeoutMs: 30_000,
  });
}

function write(repo: string, name: string, content: string | Buffer) {
  const target = path.join(repo, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

async function fixture(extra: Record<string, string | Buffer> = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-public-seed-"));
  fixtureDirs.push(parent);
  const repo = path.join(parent, "repo");
  fs.mkdirSync(repo);
  for (const file of [
    "scripts/make-public-seed.sh", "scripts/devhub-update.sh", "scripts/scan-leaks.sh",
    "scripts/lib/public-paths.sh", "scripts/lib/git-lock.sh", "scripts/git-locked.mjs",
    "apps/core/src/lib/git/mutation-queue.ts", "apps/core/src/lib/process-lock.ts", "packages/shared/process/directory-lock.ts",
  ]) {
    const destination = path.join(repo, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, file), destination);
  }
  const files: Record<string, string | Buffer> = {
    ".gitignore": "*.log\n",
    "apps/ui/lib/pr-slack.ts": "export const name = 'public';\n",
    "apps/ui/lib/utils.ts": "export const name = 'public';\n",
    "packages/shared/utils.ts": "export const name = 'public';\n",
    "docs/public.md": "Public documentation\n",
    "docs/private/secret.md": "Private documentation\n",
    "docs/codebase-review-old.md": "Private review\n",
    "scripts/private/secret.sh": "Private script\n",
    "private/docs/archive/plan.md": "Private archive\n",
    "notes/secret.json": "Private notes\n",
    "tasks/secret.json": "Private tasks\n",
    "reps/secret.json": "Private reps\n",
    "diagrams/secret.json": "Private diagrams\n",
    "skills/shared/my-voice/writing-style.md": "Private voice\n",
    "skills/local/private.md": "Private skill\n",
    "MCP_PARITY_AUDIT.md": "Old private audit\n",
    "ONE_TIME_SHARE_PLAN.md": "Old private plan\n",
    "TEMPLATE_AND_PLUGIN_PLAN.md": "Old private plan\n",
    ...extra,
  };
  for (const [name, content] of Object.entries(files)) write(repo, name, content);
  for (const args of [["init", "-q", "-b", "main"], ["config", "user.name", "Fixture"], ["config", "user.email", "fixture@example.test"], ["add", "-f", "-A"], ["commit", "-qm", "fixture"]]) {
    await run("git", args, repo);
  }
  return { repo, output: path.join(parent, "new-seed") };
}

async function seed(repo: string, output: string) {
  expect(fs.existsSync(output)).toBe(false);
  return run("bash", [path.join(repo, "scripts/make-public-seed.sh"), output], repo);
}

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!fs.existsSync(seedScript))("public seed boundary", () => {
  it("exports only public paths and excludes historical plan names", async () => {
    const { repo, output } = await fixture();
    await seed(repo, output);
    for (const name of ["private", "reps", "diagrams", "MCP_PARITY_AUDIT.md", "ONE_TIME_SHARE_PLAN.md", "TEMPLATE_AND_PLUGIN_PLAN.md", "docs/private", "docs/codebase-review-old.md", "scripts/private", "skills/shared/my-voice/writing-style.md", "skills/local", "scripts/make-public-seed.sh"]) {
      expect(fs.existsSync(path.join(output, name)), name).toBe(false);
    }
    for (const name of ["docs/public.md", "notes/.gitkeep", "tasks/.gitkeep", "collections/.gitkeep", "upstarts/.gitkeep"]) {
      expect(fs.existsSync(path.join(output, name)), name).toBe(true);
    }
  });

  it.each([
    ["apps/ui/private.log", false],
    ["apps/ui/private.bin", true],
    ["scripts/devhub-backport.sh", false],
  ])("scans %s and removes failed output", async (name, binary) => {
    const secret = "gh" + "p_" + "A".repeat(36);
    const content = binary ? Buffer.concat([Buffer.from([0]), Buffer.from(secret)]) : secret;
    const { repo, output } = await fixture({ [name]: content });
    await expect(seed(repo, output)).rejects.toThrow(/Leak scan FAILED/);
    expect(fs.existsSync(output)).toBe(false);
  });

  it("refuses a seed when its scanner differs from HEAD", async () => {
    const { repo, output } = await fixture();
    write(repo, "scripts/scan-leaks.sh", "changed\n");
    await expect(seed(repo, output)).rejects.toThrow(/scanner must match HEAD/);
    expect(fs.existsSync(output)).toBe(false);
  });

  it("refuses staged private archives and historical plan names during update", async () => {
    const { repo } = await fixture();
    for (const name of ["private/docs/archive/plan.md", "MCP_PARITY_AUDIT.md", "ONE_TIME_SHARE_PLAN.md", "TEMPLATE_AND_PLUGIN_PLAN.md"]) {
      write(repo, name, "Changed private content\n");
      await run("git", ["add", name], repo);
      await expect(run("bash", [path.join(repo, "scripts/devhub-update.sh"), "--dry-run"], repo)).rejects.toThrow(/Staged changes in personal-data paths/);
      await run("git", ["reset", "-q", "HEAD", "--", name], repo);
    }
  });

});
