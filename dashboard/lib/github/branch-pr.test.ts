import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/gh-exec", () => ({
  execGh: vi.fn(),
}));

import { execGh } from "@/lib/gh-exec";
import { findOpenPrForHeadBranch } from "./branch-pr";

describe("findOpenPrForHeadBranch", () => {
  beforeEach(() => {
    vi.mocked(execGh).mockReset();
  });

  it("returns null for HEAD / empty branch", async () => {
    expect(await findOpenPrForHeadBranch("/tmp/repo", "HEAD")).toBeNull();
    expect(await findOpenPrForHeadBranch("/tmp/repo", "  ")).toBeNull();
    expect(execGh).not.toHaveBeenCalled();
  });

  it("returns the first open PR for the head branch", async () => {
    vi.mocked(execGh).mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 42,
          title: "Add search agent",
          url: "https://github.com/acme/demo-app/pull/42",
        },
      ]),
      stderr: "",
    });

    await expect(findOpenPrForHeadBranch("/tmp/demo-app", "feature/search-agent")).resolves.toEqual({
      number: 42,
      title: "Add search agent",
      url: "https://github.com/acme/demo-app/pull/42",
      // A PR with no statusCheckRollup reports "none" rather than a false green.
      checks: "none",
      checkCounts: { passed: 0, failed: 0, pending: 0 },
    });

    expect(execGh).toHaveBeenCalledWith(
      [
        "pr",
        "list",
        "--head",
        "feature/search-agent",
        "--state",
        "open",
        "--limit",
        "1",
        "--json",
        "number,title,url,statusCheckRollup",
      ],
      { cwd: "/tmp/demo-app" },
    );
  });

  it("returns null when gh fails or finds nothing", async () => {
    vi.mocked(execGh).mockResolvedValue({ stdout: "[]", stderr: "" });
    expect(await findOpenPrForHeadBranch("/tmp/repo", "feature")).toBeNull();

    vi.mocked(execGh).mockRejectedValue(new Error("not a github repo"));
    expect(await findOpenPrForHeadBranch("/tmp/repo", "feature")).toBeNull();
  });
});
