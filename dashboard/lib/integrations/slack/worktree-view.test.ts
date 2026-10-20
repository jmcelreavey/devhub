import os from "node:os";
import { describe, expect, it } from "vitest";
import { formatWorktreeList, formatWorktreePreview, joinWorktrees, parseWorktreeList, parseWorktreeRemoval, WORKTREE_LIMIT, type WorktreeRow } from "./worktree-view";

const listText = JSON.stringify({
  rows: [
    { repo: "app", path: "/wt/a", branch: "feat/a", reason: "pr-merged", pr: { number: 12 } },
    { repo: "app", path: "/wt/b", branch: null, reason: "folder-missing" },
    { repo: "api", path: "/wt/c", branch: "devhub/agent/x", reason: "run-finished" },
    { repo: "", path: "/bad" },
  ],
  kept: 3, failedRepos: ["web", 7],
});

describe("parsing the cleanup tool's JSON", () => {
  it("reads rows with a plain-words reason and ignores rows it can't use", () => {
    const parsed = parseWorktreeList(listText)!;
    expect(parsed.rows.map((row) => [row.path, row.branch, row.reason])).toEqual([["/wt/a", "feat/a", "PR #12 merged"], ["/wt/b", null, "folder already gone"], ["/wt/c", "devhub/agent/x", "agent run finished"]]);
    expect(parsed).toMatchObject({ kept: 3, failedRepos: ["web"] });
  });
  it("returns undefined for anything that isn't a list or a removal", () => {
    expect(parseWorktreeList("gh not signed in")).toBeUndefined();
    expect(parseWorktreeList("[]")).toBeUndefined();
    expect(parseWorktreeRemoval(JSON.stringify({ rows: [] }))).toBeUndefined();
    expect(parseWorktreeRemoval(JSON.stringify({ removed: ["/a"], skipped: [{ repo: "app", path: "/b" }] }))!.skipped).toEqual([{ repo: "app", path: "/b", reason: "left alone" }]);
  });
});

describe("joinWorktrees", () => {
  const list = parseWorktreeList(listText)!;
  it("marks what a dry run would remove as clean and the rest as skipped with its reason, clean first", () => {
    const view = joinWorktrees(list, { removed: ["/wt/c"], skipped: [{ repo: "app", path: "/wt/a", reason: "it has uncommitted changes" }, { repo: "app", path: "/wt/b", reason: "an agent run is still going" }] });
    expect(view.rows.map((row) => [row.path, row.state, row.skipReason])).toEqual([["/wt/c", "clean", undefined], ["/wt/a", "skipped", "it has uncommitted changes"], ["/wt/b", "skipped", "an agent run is still going"]]);
    expect(view.kept).toBe(3);
  });
});

describe("formatWorktreeList", () => {
  const row = (n: number, state: WorktreeRow["state"] = "clean", skipReason?: string): WorktreeRow => ({ repo: "app", path: `/wt/${n}`, branch: `feat/${n}`, reason: "PR merged", state, skipReason });
  it("shows branch, path, reason and clean/dirty, and a primary Clean up N button", () => {
    const view = { rows: [row(1), row(2, "skipped", "it has uncommitted changes"), row(3, "skipped", "an agent run is still going")], kept: 0, failedRepos: [] };
    const message = formatWorktreeList({ view, channel: "C", cleanId: "id1" });
    const body = JSON.stringify(message.blocks);
    expect(body).toContain("app · feat/1");
    expect(body).toContain("/wt/1 · PR merged · clean");
    expect(body).toContain("PR merged · dirty");
    expect(body).toContain("skipped: an agent run is still going");
    const button = message.blocks!.flatMap((block) => block.type === "actions" ? block.elements : []) as Array<{ text: { text: string }; style?: string; value?: string }>;
    expect(button).toEqual([expect.objectContaining({ text: { type: "plain_text", text: "Clean up 1" }, style: "primary", value: "id1" })]);
  });
  it("shortens the home directory", () => {
    const message = formatWorktreeList({ view: { rows: [{ ...row(1), path: `${os.homedir()}/dev/wt` }], kept: 0, failedRepos: [] }, channel: "C" });
    expect(message.text).not.toContain(os.homedir());
    expect(JSON.stringify(message.blocks)).toContain("~/dev/wt");
  });
  it("caps the rows, offers Open in DevHub when nothing can go, and says what was left out", () => {
    const view = { rows: Array.from({ length: WORKTREE_LIMIT + 3 }, (_, i) => row(i, "skipped", "it has uncommitted changes")), kept: 2, failedRepos: ["web"] };
    const message = formatWorktreeList({ view, channel: "C" });
    expect(message.blocks!.length).toBeLessThanOrEqual(50);
    const body = JSON.stringify(message.blocks);
    expect(body).toContain("+3 more");
    expect(body).toContain("2 more in use or locked, left out");
    expect(body).toContain("couldn't read 1 repo");
    expect(body).toContain("Open in DevHub");
    expect(body).not.toContain("Clean up");
  });
  it("has an empty state", () => {
    expect(formatWorktreeList({ view: { rows: [], kept: 0, failedRepos: [] }, channel: "C" }).text).toContain("No finished worktrees");
  });
});

describe("formatWorktreePreview", () => {
  const rows: WorktreeRow[] = [{ repo: "app", path: "/wt/a", branch: "feat/a", reason: "PR #12 merged", state: "clean" }];
  it("names the count in a red button, lists skipped trees, and warns it can't be undone", () => {
    const message = formatWorktreePreview({ preview: { removable: [{ repo: "app", path: "/wt/a" }], skipped: [{ repo: "api", path: "/wt/z", reason: "it has uncommitted changes" }] }, rows, channel: "C", threadTs: "1.1", confirmId: "id9" });
    const body = JSON.stringify(message.blocks);
    expect(message.text).toContain("Remove 1 worktree?");
    expect(body).toContain("app · feat/a — /wt/a (PR #12 merged)");
    expect(body).toContain("Skipped, left as they are");
    expect(body).toContain("it has uncommitted changes");
    expect(body).toContain("can't be undone");
    const buttons = message.blocks!.flatMap((block) => block.type === "actions" ? block.elements : []) as Array<{ text: { text: string }; style?: string; value?: string; action_id: string }>;
    expect(buttons.map((button) => [button.action_id, button.text.text, button.style, button.value])).toEqual([["devhub_tool_confirm", "Yes, remove 1", "danger", "id9"], ["devhub_tool_cancel", "Cancel", undefined, "id9"]]);
  });
  it("has no buttons when nothing can be removed", () => {
    const message = formatWorktreePreview({ preview: { removable: [], skipped: [{ repo: "api", path: "/wt/z", reason: "an agent run is still going" }] }, rows, channel: "C" });
    expect(message.text).toContain("Nothing to remove");
    expect(JSON.stringify(message.blocks)).not.toContain("\"actions\"");
  });
  it("caps a long preview", () => {
    const removable = Array.from({ length: 40 }, (_, i) => ({ repo: "app", path: `/wt/${i}` }));
    const message = formatWorktreePreview({ preview: { removable, skipped: [] }, rows: [], channel: "C", confirmId: "x" });
    expect(JSON.stringify(message.blocks)).toContain("+25 more");
    expect(message.blocks!.length).toBeLessThanOrEqual(50);
  });
});
