import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let scanDir: string;

vi.mock("@/lib/repos", () => ({
  getReposScanDir: () => scanDir,
  // Stands in for reading the clone's origin: widgets → acme/widgets, anything else has no GitHub remote.
  getGithubFullNameForLocalRepo: (dir: string) => (path.basename(dir).startsWith("widgets") ? `acme/${path.basename(dir)}` : null),
}));

const { githubFullNameForLocalName, localGithubRepos } = await import("./local-repos");

function clone(name: string, gitAsFile = false) {
  const dir = path.join(scanDir, name);
  fs.mkdirSync(dir, { recursive: true });
  if (gitAsFile) fs.writeFileSync(path.join(dir, ".git"), "gitdir: ../elsewhere");
  else fs.mkdirSync(path.join(dir, ".git"));
}

beforeEach(() => {
  scanDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-conv-local-"));
});

afterEach(() => {
  fs.rmSync(scanDir, { recursive: true, force: true });
});

describe("localGithubRepos", () => {
  it("lists clones, including worktrees whose .git is a file, that have a GitHub remote", () => {
    clone("widgets");
    clone("widgets-wt", true);
    clone("scratch");
    fs.mkdirSync(path.join(scanDir, "not-a-repo"));
    expect(localGithubRepos().map((r) => r.fullName).sort()).toEqual(["acme/widgets", "acme/widgets-wt"]);
  });

  it("is empty when the scan dir is missing", () => {
    fs.rmSync(scanDir, { recursive: true, force: true });
    expect(localGithubRepos()).toEqual([]);
  });
});

describe("githubFullNameForLocalName", () => {
  it("resolves a direct child clone", () => {
    clone("widgets");
    expect(githubFullNameForLocalName("widgets")).toBe("acme/widgets");
  });

  it("returns null for a missing clone or one without a GitHub remote", () => {
    clone("scratch");
    expect(githubFullNameForLocalName("scratch")).toBeNull();
    expect(githubFullNameForLocalName("ghost")).toBeNull();
  });

  it("refuses anything that is not a plain folder name", () => {
    clone("widgets");
    for (const bad of ["../widgets", "a/b", "-widgets", "wid gets", "..", ""]) {
      expect(githubFullNameForLocalName(bad)).toBeNull();
    }
  });
});
