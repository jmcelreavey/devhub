import { describe, expect, it } from "vitest";
import { toolResultCard } from "./result-format";
import { formatToolResult } from "./tool-format";

const baseUrl = "http://localhost:1337";
const reply = (tool: string, data: unknown, text = JSON.stringify(data)) => formatToolResult({ tool, data, text, profile: "work", channel: "CCHANNEL", threadTs: "1.1", baseUrl });
const pr = (number: number, patch: Record<string, unknown> = {}) => ({ number, repo: "team/service", title: `Fix number ${number}`, url: `https://github.com/team/service/pull/${number}`, checks: "passing", checkCounts: { passed: 3, failed: 0, pending: 0 }, ...patch });

describe("Slack PR cards", () => {
  it("shows compact linked rows, counts and one primary action, with per-section overflow links", () => {
    const message = reply("prs_list", { authored: Array.from({ length: 9 }, (_, index) => pr(index + 1)), reviews: Array.from({ length: 63 }, (_, index) => pr(index + 10)) });
    expect(message.blocks?.[0]).toEqual({ type: "header", text: { type: "plain_text", text: "Pull requests · 72" } });
    const blocks = JSON.stringify(message.blocks);
    expect(blocks).toContain("*Authored · 9*");
    expect(blocks).toContain("*Awaiting your review · 63*");
    expect(blocks).toContain("✅ passing · <https://github.com/team/service/pull/1|team/service#1 Fix number 1>");
    expect(blocks).toContain("3 passed");
    expect(blocks).not.toContain("Fix number 7");
    expect(blocks).not.toContain("Fix number 16");
    expect(blocks).toContain("+3 more · <http://localhost:1337/prs?tab=authored|Open in DevHub>");
    expect(blocks).toContain("+57 more · <http://localhost:1337/prs?tab=reviews|Open in DevHub>");
    expect(message.blocks?.filter((block) => block.type === "actions")).toEqual([{ type: "actions", elements: [{ type: "button", action_id: "devhub_open", text: { type: "plain_text", text: "Open in DevHub" }, style: "primary", url: `${baseUrl}/prs` }] }]);
    expect(message).toMatchObject({ channel: "CCHANNEL", thread_ts: "1.1", mrkdwn: false, unfurl_links: false, unfurl_media: false });
    expect(message.text).not.toMatch(/https?:\/\/|\{\s*"/);
  });
  it("renders drafts, failing and pending checks without inventing a passing status", () => {
    const message = reply("prs_list", { authored: [pr(1, { draft: true }), pr(2, { checks: "failing" }), pr(3, { checks: "pending" }), pr(4, { checks: "none" })], reviews: [] });
    expect(message.text).toContain("📝 draft");
    expect(message.text).toContain("❌ failing");
    expect(message.text).toContain("⏳ pending");
    expect(message.text).toContain("no checks");
    expect(message.text).toContain("No PRs waiting for your review");
  });
  it("leaves the status off a PR whose checks aren't known yet", () => {
    const row = { ...pr(5), checks: undefined, checkCounts: undefined };
    const message = reply("prs_list", { authored: [row], reviews: [] });
    expect(JSON.stringify(message.blocks)).toContain("<https://github.com/team/service/pull/5|team/service#5 Fix number 5>");
    expect(message.text).not.toContain("no checks");
  });
  it("still formats the existing MCP text, without needing the additive structured result", () => {
    const text = "Authored (1):\n  - team/service#12 [failing: 2✓ 1✗ 0…] ✓approved Fix <mentions> & links\n    https://github.com/team/service/pull/12\n\nAwaiting my review (0):\n  (none)";
    const message = reply("prs_list", undefined, text);
    expect(JSON.stringify(message.blocks)).toContain("❌ failing · <https://github.com/team/service/pull/12|team/service#12 Fix &lt;mentions&gt; &amp; links>");
    expect(message.text).toContain("2 passed · 1 failed · Approved");
    expect(message.blocks?.[0]).toMatchObject({ text: { text: "Pull requests · 1" } });
  });
  it("has a useful empty state for both queues", () => {
    const message = reply("prs_list", { authored: [], reviews: [] });
    expect(message.text).toContain("Pull requests · 0");
    expect(message.text).toContain("No open PRs authored by you");
    expect(message.text).toContain("No PRs waiting for your review");
  });
});

describe("tool-group presentation", () => {
  it("links storyboard tasks to their original profile and shows state and short metadata", () => {
    const message = reply("storyboard_board", { cards: [{ taskId: "task-one", title: "Fix feed", status: "needs-you", repo: "feeds", jira: ["PTF-12"], openQuestions: 1 }] });
    const blocks = JSON.stringify(message.blocks);
    expect(blocks).toContain("<http://localhost:1337/storyboard?task=task-one&amp;profile=work|Fix feed>");
    expect(message.text).toContain("👀 needs you");
    expect(message.text).toContain("Jira: PTF-12");
    expect(message.text).toContain("Open Questions: 1");
  });
  it("formats the existing checkbox task list", () => {
    const message = reply("tasks_list", undefined, "Tasks for 2026-10-18 (1/2 done, 0 abandoned, 0 moved):\n- [x] Finished task\n- [ ] Next task [PTF-12] (due 2026-10-20)");
    expect(message.text).toContain("Tasks · 2");
    expect(message.text).toContain("✅ done · Finished task");
    expect(message.text).toContain("📝 todo · Next task");
  });
  it("formats Jira objects and the existing list output", () => {
    const message = reply("jira_ticket_get", { key: "PTF-12", summary: "Fix feed", status: { name: "In progress" }, url: "https://jira.example/browse/PTF-12" });
    expect(JSON.stringify(message.blocks)).toContain("<https://jira.example/browse/PTF-12|PTF-12 Fix feed>");
    expect(message.text).toContain("⏳ In progress");
    const legacy = reply("jira_tickets", undefined, "My Jira tickets:\n- PTF-12 [Done] Fix feed");
    expect(legacy.text).toContain("✅ Done · PTF-12 Fix feed");
    expect(JSON.stringify(legacy.blocks)).toContain("http://localhost:1337/work?tab=jira");
  });
  it("puts event times in context and links the event when available", () => {
    const message = reply("calendar_week", { days: { "2026-10-19": [{ summary: "Planning", start: "09:00", end: "09:30", htmlLink: "https://calendar.google.com/event?eid=1" }] } });
    expect(message.text).toContain("Calendar · 1");
    expect(JSON.stringify(message.blocks)).toContain("<https://calendar.google.com/event?eid=1|Planning>");
    expect(message.text).toContain("2026-10-19 · 09:00–09:30");
    const legacy = reply("calendar_week", undefined, "**2026-10-19**\n  - 09:00–09:30 Planning");
    expect(legacy.text).toContain("Planning");
    expect(legacy.text).toContain("2026-10-19");
    expect(legacy.blocks?.find((block) => block.type === "section")).toMatchObject({ text: { text: "<http://localhost:1337/calendar|Planning>" } });
  });
  it("links notes without exposing the local notes-directory heading", () => {
    const message = reply("notes_list", undefined, "Notes in /Users/private/notes:\n📁 daily/\n📄 daily/2026-10-18.json\n📄 scratch.json");
    expect(message.text).not.toContain("Users/private");
    expect(JSON.stringify(message.blocks)).toContain("<http://localhost:1337/notes/daily/2026-10-18|daily/2026-10-18>");
  });
  it("shows agent runs with state and provider, not internal error output", () => {
    const message = reply("agent_runs", undefined, "Agent runs (1):\n- run-one · Codex · failed · Fix feed — E_INTERNAL secret-stack");
    expect(message.text).toContain("❌ failed · Fix feed");
    expect(message.text).toContain("Provider: Codex");
    expect(message.text).not.toMatch(/E_INTERNAL|secret-stack/);
    expect(JSON.stringify(message.blocks)).toContain("http://localhost:1337/agents?run=run-one");
  });
  it("shows worktree branch/repo and path metadata, with the correct cleanup destination", () => {
    const message = reply("repos_worktree_cleanup", { rows: [{ repo: "feeds", branch: "fix/feed", path: "/tmp/feeds-checkout", reason: "merged" }] });
    expect(message.text).toContain("Worktrees · 1");
    expect(message.text).toContain("feeds · fix/feed");
    expect(message.text).toContain("/tmp/feeds-checkout · merged");
    expect(JSON.stringify(message.blocks)).toContain('"url":"http://localhost:1337/prs?tab=cleanup"');
  });
  it("renders unknown JSON as labelled fields, never a JSON dump or sensitive fields", () => {
    const message = reply("example_status", { state: "ready", total: 4, service: { name: "Feeds" }, token: "secret-token", stack: "private-stack" });
    expect(message.text).toContain("State: ready");
    expect(message.text).toContain("Total: 4");
    expect(message.text).toContain("Service: Feeds");
    expect(JSON.stringify(message)).not.toMatch(/secret-token|private-stack|\\"state\\"/);
    expect(message.text).not.toContain("{");
  });
  it("never emits a bare URL line from a generic textual result", () => {
    const message = reply("example_read", undefined, "Created a report\nhttps://example.com/report\nRead more at https://example.com/details");
    expect(message.text).not.toContain("https://");
    expect(JSON.stringify(message.blocks)).toContain("<https://example.com/report|Created a report>");
  });
  it("keeps a note's Open button on that note and handles nested JSON strings without dumping them", () => {
    const message = formatToolResult({ tool: "notes_read", text: "# daily/2026-10-18\nA short note", args: { path: "daily/2026-10-18.json" }, profile: "work", channel: "C", baseUrl });
    expect(JSON.stringify(message.blocks)).toContain('"url":"http://localhost:1337/notes/daily/2026-10-18"');
    const nested = reply("example_status", { payload: '{"state":"ready"}' });
    expect(nested.text).toContain("Payload: ready");
    expect(nested.text).not.toMatch(/[{}]/);
  });
  it("keeps unknown tools discoverable rather than requiring a formatter registration", () => {
    const card = toolResultCard({ tool: "new_tool", text: '[{"name":"First","status":"ready"}]', profile: "work" });
    expect(card).toMatchObject({ title: "New tool", count: 1, sections: [{ items: [{ title: "First", status: "✅ ready" }] }] });
  });
  it.each(['```json\n{"state":"ready"}\n```', '```json\n{"state":\n```'])("does not leak fenced JSON, even if it is malformed", (text) => {
    const message = reply("example_status", undefined, text);
    expect(message.text).not.toMatch(/[{}]|```/);
  });
});

describe("worktree cleanup results", () => {
  it("shows what was removed and what was left alone, and says a dry run only would", () => {
    const text = JSON.stringify({ dryRun: false, ok: true, removed: ["/wt/app-merged"], skipped: [{ repo: "app", path: "/wt/app-dirty", reason: "it has uncommitted changes" }] });
    const card = toolResultCard({ tool: "repos_worktree_cleanup", text, profile: "work" });
    expect(card.sections.map((section) => [section.title, section.items.map((item) => item.title)])).toEqual([["Removed", ["app-merged"]], ["Left alone", ["app · app-dirty"]]]);
    expect(card.sections[1].items[0].meta).toBe("it has uncommitted changes");
    const dry = toolResultCard({ tool: "repos_worktree_cleanup", text: JSON.stringify({ dryRun: true, removed: [], skipped: [] }), profile: "work" });
    expect(dry.sections[0]).toMatchObject({ title: "Would remove", empty: "Nothing was removed." });
  });
});
