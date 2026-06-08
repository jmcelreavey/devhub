import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GH_AUTH_REQUIRED_MESSAGE } from "./gh-exec";

vi.mock("./gh-exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gh-exec")>();
  return {
    ...actual,
    execGh: vi.fn(),
    isGithubCliAuthenticated: vi.fn(),
  };
});

vi.mock("./git-repo-local", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./git-repo-local")>();
  return {
    ...actual,
    readOriginRemoteUrl: vi.fn(),
    gitFetchOriginBranch: vi.fn(),
    gitShortRef: vi.fn(),
    gitExtractSubtreeArchive: vi.fn(),
  };
});

import { execGh, isGithubCliAuthenticated } from "./gh-exec";
import {
  gitExtractSubtreeArchive,
  gitFetchOriginBranch,
  gitShortRef,
  readOriginRemoteUrl,
} from "./git-repo-local";
import { refreshUpstreamSkills } from "./upstream-skills-refresh";
import { readUpstreamSkillsManifest } from "./upstream-skills-cache";

describe("refreshUpstreamSkills", () => {
  const mockedAuth = vi.mocked(isGithubCliAuthenticated);
  const mockedExecGh = vi.mocked(execGh);
  const mockedRemote = vi.mocked(readOriginRemoteUrl);
  const mockedFetch = vi.mocked(gitFetchOriginBranch);
  const mockedShortRef = vi.mocked(gitShortRef);
  const mockedExtract = vi.mocked(gitExtractSubtreeArchive);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedAuth.mockResolvedValue(true);
    mockedRemote.mockReturnValue("git@github.com:example-org/ai-tools.git");
    mockedShortRef.mockReturnValue("abc1234");
    mockedExecGh.mockResolvedValue({ stdout: "main\n", stderr: "" });
    mockedFetch.mockResolvedValue(undefined);
    mockedExtract.mockImplementation((_repo, _ref, _path, extractRoot) => {
      fs.mkdirSync(path.join(extractRoot, "skills", "demo"), { recursive: true });
      fs.writeFileSync(path.join(extractRoot, "skills", "demo", "SKILL.md"), "# demo\n");
    });
  });

  it("fetches default branch and caches skills without touching checkout", async () => {
    const checkoutRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-upstream-"));
    fs.mkdirSync(path.join(checkoutRoot, ".git"), { recursive: true });

    const result = await refreshUpstreamSkills({ checkoutRoot });

    expect(result.ok).toBe(true);
    expect(result.branch).toBe("main");
    expect(result.repo).toBe("example-org/ai-tools");
    expect(mockedFetch).toHaveBeenCalledWith(checkoutRoot, "main");
    expect(mockedExtract).toHaveBeenCalledWith(
      checkoutRoot,
      "origin/main",
      "skills",
      expect.stringContaining("example-org--ai-tools"),
    );

    const manifest = readUpstreamSkillsManifest();
    expect(manifest?.checkoutRoot).toBe(path.resolve(checkoutRoot));
    expect(manifest?.skillsDir).toContain("skills");
    expect(fs.existsSync(path.join(manifest!.skillsDir, "demo", "SKILL.md"))).toBe(true);

    fs.rmSync(checkoutRoot, { recursive: true, force: true });
    if (manifest?.skillsDir) {
      fs.rmSync(path.dirname(path.dirname(path.dirname(manifest.skillsDir))), {
        recursive: true,
        force: true,
      });
    }
  });

  it("returns auth guidance when gh is not logged in", async () => {
    mockedAuth.mockResolvedValue(false);

    const result = await refreshUpstreamSkills({ checkoutRoot: "/tmp/example" });

    expect(result.ok).toBe(false);
    expect(result.warning).toBe(GH_AUTH_REQUIRED_MESSAGE);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
