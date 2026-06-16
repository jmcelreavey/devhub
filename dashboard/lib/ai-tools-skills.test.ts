import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isAiToolsAvailable,
  listAiToolsSkillNames,
  refreshAiToolsRepo,
  resolveAiToolsRoot,
} from "./ai-tools-skills";
import { GH_AUTH_REQUIRED_MESSAGE } from "./gh-exec";

vi.mock("./upstream-skills-refresh", () => ({
  refreshUpstreamSkills: vi.fn(),
}));

import { refreshUpstreamSkills } from "./upstream-skills-refresh";

describe("ai-tools-skills", () => {
  const prevRoot = process.env.AI_TOOLS_ROOT;
  const mockedRefresh = vi.mocked(refreshUpstreamSkills);

  beforeEach(() => {
    mockedRefresh.mockReset();
    mockedRefresh.mockResolvedValue({
      ok: true,
      commit: "abc1234",
      branch: "main",
      repo: "businessinsider/ai-tools",
    });
  });

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.AI_TOOLS_ROOT;
    else process.env.AI_TOOLS_ROOT = prevRoot;
  });

  it("lists skills with a BI prefix when checkout exists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-aitools-"));
    process.env.AI_TOOLS_ROOT = root;
    fs.mkdirSync(path.join(root, "skills/foo"), { recursive: true });
    fs.writeFileSync(path.join(root, "skills/foo/SKILL.md"), "# foo\n");
    fs.mkdirSync(path.join(root, "skills/bi-bar"), { recursive: true });
    fs.writeFileSync(path.join(root, "skills/bi-bar/SKILL.md"), "# bar\n");

    expect(isAiToolsAvailable()).toBe(true);
    expect(listAiToolsSkillNames()).toEqual(["bi-bar", "bi-foo"]);
    expect(resolveAiToolsRoot()).toBe(path.resolve(root));

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns false when skills dir missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-aitools-empty-"));
    process.env.AI_TOOLS_ROOT = root;
    expect(isAiToolsAvailable()).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("refreshAiToolsRepo delegates to refreshUpstreamSkills", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-aitools-sync-"));
    process.env.AI_TOOLS_ROOT = root;
    fs.mkdirSync(path.join(root, "skills"), { recursive: true });
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });

    const result = await refreshAiToolsRepo({ emit: () => undefined, root });

    expect(result.ok).toBe(true);
    expect(result.pulled).toBe(true);
    expect(result.commit).toBe("abc1234");
    expect(mockedRefresh).toHaveBeenCalledWith({ checkoutRoot: root });

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("refreshAiToolsRepo surfaces auth guidance from refreshUpstreamSkills", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-aitools-auth-"));
    process.env.AI_TOOLS_ROOT = root;
    fs.mkdirSync(path.join(root, "skills"), { recursive: true });
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });

    mockedRefresh.mockResolvedValue({ ok: false, warning: GH_AUTH_REQUIRED_MESSAGE });

    const result = await refreshAiToolsRepo({ emit: () => undefined, root });

    expect(result.ok).toBe(false);
    expect(result.warning).toBe(GH_AUTH_REQUIRED_MESSAGE);

    fs.rmSync(root, { recursive: true, force: true });
  });
});
