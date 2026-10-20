import { describe, expect, it } from "vitest";
import { buildHomeView, buildPrivateHomeView, HOME_NEEDS_LIMIT, HOME_PRS_LIMIT, HOME_TASKS_LIMIT, type SlackHomeInput } from "./home-view";
import type { SlackNeed } from "./needs-you-source";

const base: SlackHomeInput = { profile: "work", channel: "CCHANNEL", now: Date.parse("2026-10-18T12:00:00Z"), needs: [], tasks: [], prs: { configured: true, stale: false, sections: { mine: [], review: [], owned: [] } } };
const need: SlackNeed = { profile: "work", entityId: "task:t1", taskId: "t1", title: "Fix <!channel> & ads", needed: "Ready to start", itemKey: "k", href: "/work/tasks/t1", action: "open" };

describe("App Home view", () => {
  it("groups PRs into linked rows and offers Retry + Open for failed work, with one primary", () => {
    const view = buildHomeView({ ...base, prs: { ...base.prs!, actionableCount: 2 }, needs: [
      { id: "retry", need: { ...need, action: "retry", needed: "Workflow run failed" } },
      { id: "prs", need: { ...need, taskId: undefined, entityId: "prs:actionable", prRows: [{ title: "Review one", href: "https://github.com/acme/app/pull/1", needed: "Review requested" }, { title: "Review two", href: "https://github.com/acme/app/pull/2", needed: "Review requested" }] } },
    ] });
    const body = JSON.stringify(view);
    expect(body).toContain("2 PRs need attention"); expect(body).toContain("Pull requests needing you · 2");
    expect(body).toContain("devhub_retry"); expect(body).not.toContain("devhub_need_plan"); expect(body).not.toContain("devhub_need_implement");
    const retry = view.blocks.find((block) => block.type === "actions" && block.elements.some((element) => "action_id" in element && element.action_id === "devhub_retry"));
    expect(retry?.type === "actions" && retry.elements.filter((element) => "style" in element && element.style === "primary")).toHaveLength(1);
  });
  it("shows live counts, Plan/Implement/Open, today's tasks, PRs and Refresh with a clear confirmation destination", () => {
    const view = buildHomeView({ ...base, needs: [{ id: "need-1", need }], tasks: [{ taskId: "t1", title: "Today's task", status: "To do" }], prs: { configured: true, stale: false, sections: { mine: [{ dot: "🔴", title: "Fix PR", repo: "org/repo", url: "https://github.com/org/repo/pull/1", failing: true }], review: [], owned: [] } } });
    const body = JSON.stringify(view);
    expect(view.type).toBe("home");
    expect(body).toContain("1 needs you");
    expect(body).toContain("1 task today");
    expect(body).toContain("&lt;!channel&gt; &amp; ads");
    expect(body).not.toContain("<!channel>");
    expect(body).toContain("Confirm card in <#CCHANNEL>");
    expect(body).toContain("nothing starts until you confirm there");
    expect(body).toContain("Today's task");
    expect(body).toContain("Fix PR");
    const actions = view.blocks.flatMap((block) => block.type === "actions" ? block.elements : []);
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action_id: "devhub_home_refresh" }),
      expect.objectContaining({ action_id: "devhub_tool_capabilities_home", text: { type: "plain_text", text: "What I can do" } }),
      expect.objectContaining({ action_id: "devhub_need_plan", value: "need-1" }),
      expect.objectContaining({ action_id: "devhub_need_implement", value: "need-1" }),
      expect.objectContaining({ action_id: "devhub_open", url: expect.stringContaining("/work/tasks/t1") }),
    ]));
  });

  it("bounds the whole view and puts failing CI first", () => {
    const needs = Array.from({ length: 40 }, (_, index) => ({ id: String(index), need: { ...need, taskId: String(index) } }));
    const tasks = Array.from({ length: 30 }, (_, index) => ({ taskId: String(index), title: `Task ${index}`, status: "To do" }));
    const mine = Array.from({ length: 20 }, (_, index) => ({ dot: "⚪", title: `PR ${index}`, repo: "org/repo", url: `https://github.com/org/repo/pull/${index}`, failing: index === 19 }));
    const view = buildHomeView({ ...base, needs, tasks, prs: { configured: true, stale: true, sections: { mine, review: [], owned: [] } } });
    const body = JSON.stringify(view);
    expect(view.blocks.length).toBeLessThan(100);
    expect(body.match(/devhub_need_plan/g)).toHaveLength(HOME_NEEDS_LIMIT);
    expect(body.match(/Task \d/g)).toHaveLength(HOME_TASKS_LIMIT);
    expect(body.match(/\|PR \d+/g)).toHaveLength(HOME_PRS_LIMIT);
    expect(body.indexOf("PR 19")).toBeLessThan(body.indexOf("PR 0"));
    expect(body).toContain("+32 more");
    expect(body).toContain("last list DevHub had");
  });

  it("does not offer agent actions for questions, retries or plugin attention", () => {
    for (const entry of [{ ...need, action: "answer" as const }, { ...need, action: "retry" as const }, { ...need, taskId: undefined }]) {
      const body = JSON.stringify(buildHomeView({ ...base, channel: "DDIRECT", needs: [{ id: "n", need: entry }] }));
      expect(body).not.toContain("devhub_need_plan");
      expect(body).not.toContain("devhub_need_implement");
      expect(body).toContain("your chat with DevHub");
    }
  });

  it("distinguishes empty, unconfigured and failed sources", () => {
    const empty = JSON.stringify(buildHomeView(base));
    expect(empty).toContain("Nothing is waiting on you");
    expect(empty).toContain("No tasks planned for today");
    const unavailable = JSON.stringify(buildHomeView({ ...base, needs: undefined, tasks: undefined, prs: undefined }));
    expect(unavailable).toContain("Needs-you unavailable");
    expect(unavailable).toContain("Couldn't read today's tasks");
    expect(unavailable).toContain("Couldn't read your PRs");
    expect(JSON.stringify(buildHomeView({ ...base, prs: { ...base.prs!, configured: false } }))).toContain("gh auth login");
  });

  it("publishes no private data, links or actions for another user", () => {
    const view = buildPrivateHomeView();
    expect(JSON.stringify(view)).toContain("This DevHub is private");
    expect(view.blocks).toHaveLength(2);
    expect(JSON.stringify(view)).not.toMatch(/https?:|action_id|work|taskId/);
  });
});
