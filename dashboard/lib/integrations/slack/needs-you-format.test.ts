import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatSlackDigest, formatSlackProgress, formatSlackNeed, formatSlackRetryConfirmation, slackNeedUrl } from "./needs-you-format";
import type { SlackThreadItem } from "./thread-store";

function item(patch: Partial<SlackThreadItem> = {}): SlackThreadItem {
  return { profile: "work", entityId: "task:task-id", taskId: "task-id", questionId: "q1", itemKey: "q1", title: "PTF-5135 · Feed fallback", needed: "Keep the previous result?", href: "/storyboard?task=task-id&taskProfile=work&taskSection=answer", action: "answer", teamId: "TTEAM", userId: "UOWNER", channel: "CCHANNEL", postedAt: "2026-10-18T12:00:00.000Z", resolved: false, delivery: "sent", dirty: false, ...patch };
}

beforeEach(() => vi.stubEnv("DEVHUB_BASE_URL", "http://localhost:1342"));
afterEach(() => vi.unstubAllEnvs());

describe("Needs you Block Kit messages", () => {
  it("shows suggested answers as secondary buttons without putting answer text in action values", () => {
    const options = ["Keep <all> & retry", "x".repeat(120)];
    const message = formatSlackNeed(item({ options }), "question-id", "CCHANNEL");
    const groups = message.blocks?.filter((block) => block.type === "actions");
    expect(groups).toHaveLength(2);
    expect(groups?.[1]).toMatchObject({ elements: [
      { action_id: "devhub_answer_option_0", value: "question-id", text: { type: "plain_text", text: options[0] } },
      { action_id: "devhub_answer_option_1", value: "question-id", text: { text: expect.stringMatching(/^x+…$/) } },
    ] });
    expect(JSON.stringify(groups?.[1])).not.toContain('"style"');
    expect(formatSlackNeed(item({ options }), "question-id", "CCHANNEL", undefined, "Answered").blocks?.some((block) => block.type === "actions")).toBe(false);
  });

  it("uses one compact linked PR group without per-PR action buttons", () => {
    const card = formatSlackNeed(item({ taskId: undefined, action: "open", prRows: [{ title: "First PR", href: "https://github.com/acme/app/pull/1", needed: "Review requested" }, { title: "Second PR", href: "https://github.com/acme/app/pull/2", needed: "Review requested" }] }), "group", "CCHANNEL");
    expect(JSON.stringify(card.blocks)).toContain("Pull requests needing you · 2");
    expect(card.blocks?.filter((block) => block.type === "actions")).toHaveLength(0);
  });
  it("keeps linked PR rows compact in a mixed channel digest too", () => {
    const message = formatSlackDigest([item(), item({ taskId: undefined, action: "open", prRows: [{ title: "Review one", href: "/prs?repo=acme%2Fapp&pr=1", needed: "Review requested" }] })], "CCHANNEL");
    expect(JSON.stringify(message.blocks)).toContain("Review one");
    expect(JSON.stringify(message.blocks)).toContain("repo=acme%2Fapp&amp;pr=1");
    expect(message.blocks?.filter((block) => block.type === "actions")).toHaveLength(1);
  });
  it("keeps exactly one next action and turns resolved answers into a quiet line", () => {
    const question = item();
    expect(formatSlackNeed(question, "item-id", question.channel).blocks?.find((block) => block.type === "actions")).toEqual({ type: "actions", elements: [
      { type: "button", action_id: "devhub_answer", value: "item-id", text: { type: "plain_text", text: "Answer" }, style: "primary" },
      { type: "button", action_id: "devhub_open", text: { type: "plain_text", text: "Open" }, url: slackNeedUrl(question) },
    ] });
    const resolved = formatSlackNeed(question, "item-id", question.channel, undefined, "Answered in DevHub");
    expect(resolved.text).toContain("Answered in DevHub");
    expect(resolved.blocks?.some((block) => block.type === "actions")).toBe(false);
  });

  describe("buttons by what the item is waiting on", () => {
    const actions = (message: ReturnType<typeof formatSlackNeed>) => (message.blocks?.find((block) => block.type === "actions") as { elements: Array<{ action_id: string; style?: string; url?: string; value?: string }> }).elements;
    it("offers Plan, Implement and Open on a task that is only waiting to be picked up, with Open as the one primary", () => {
      const task = item({ action: "open", questionId: undefined });
      const elements = actions(formatSlackNeed(task, "item-id", task.channel));
      expect(elements.map((element) => element.action_id)).toEqual(["devhub_need_plan", "devhub_need_implement", "devhub_open"]);
      expect(elements.filter((element) => element.style === "primary").map((element) => element.action_id)).toEqual(["devhub_open"]);
      expect(elements[0].value).toBe("item-id");
      expect(elements[2].url).toBe(slackNeedUrl(task));
    });
    it("keeps Retry as the primary on a retry item and adds a plain Open, with no Plan or Implement", () => {
      const task = item({ action: "retry", questionId: undefined });
      const elements = actions(formatSlackNeed(task, "item-id", task.channel));
      expect(elements.map((element) => [element.action_id, element.style])).toEqual([["devhub_retry", "primary"], ["devhub_open", undefined]]);
    });
    it("gives a PR (no task) only the Open link, and a resolved card no buttons", () => {
      const pr = item({ action: "open", taskId: undefined, questionId: undefined, entityId: "pr:repo#1" });
      expect(actions(formatSlackNeed(pr, "item-id", pr.channel)).map((element) => element.action_id)).toEqual(["devhub_open"]);
      const task = item({ action: "open", questionId: undefined });
      expect(formatSlackNeed(task, "item-id", task.channel, undefined, "Resolved").blocks?.some((block) => block.type === "actions")).toBe(false);
    });
  });

  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", "http://user:secret@localhost:1342/storyboard"])("rejects a non-DevHub or credential-bearing link: %s", (href) => {
    expect(slackNeedUrl({ href })).toBe("http://localhost:1342/storyboard");
  });

  it("keeps mentions and injected links literal, with bounded one-line titles and questions", () => {
    const message = formatSlackNeed(item({ title: "<!channel> & <@UOTHER>\n".repeat(80), needed: "<https://evil.test|click>\n".repeat(80) }), "item-id", "CCHANNEL");
    expect(message).toMatchObject({ mrkdwn: false, parse: "none", unfurl_links: false, unfurl_media: false });
    expect(message.text).toContain("&lt;!channel&gt;");
    expect(JSON.stringify(message.blocks)).not.toContain("<!channel>");
    expect(message.blocks?.filter((block) => block.type === "section")).toHaveLength(1);
    expect(JSON.stringify(message.blocks)).toContain('"verbatim":true');
  });

  it("caps a digest without truncating its reply instructions and identifies keyless tasks", () => {
    const items = Array.from({ length: 30 }, (_, index) => item({ title: "Unfiled child ".repeat(20), taskId: `child-${index}`, needed: "A long question ".repeat(20) }));
    const message = formatSlackDigest(items, "CCHANNEL");
    expect(message.text).toContain("[child-0]");
    expect(message.text).toContain("+24 more in DevHub");
    expect(message.text).toContain("Jira key or task ID followed by :");
    expect(message.text.length).toBeLessThan(3000);
    expect(message.blocks?.[0]).toEqual({ type: "header", text: { type: "plain_text", text: "Needs you · 30" } });
    expect(message.blocks?.find((block) => block.type === "actions")).toMatchObject({ type: "actions", elements: [{ action_id: "devhub_open", url: "http://localhost:1342/storyboard?attention=needs-you&profile=work" }] });
  });

  it("names the task and keeps Confirm and Cancel separate from the original Retry button", () => {
    const message = formatSlackRetryConfirmation(item({ action: "retry", thread_ts: "100.1" }), "confirmation-token");
    expect(message.text).toContain("Retry PTF-5135");
    expect(message.text).toContain("Confirm within 5 minutes");
    expect(message.thread_ts).toBe("100.1");
    expect(message.blocks?.find((block) => block.type === "actions")).toMatchObject({ type: "actions", elements: [{ action_id: "devhub_confirm_retry", value: "confirmation-token", style: "primary" }, { action_id: "devhub_cancel_retry", value: "confirmation-token" }] });
  });

  it("doesn't invite answers to a digest without any open task questions", () => {
    const message = formatSlackDigest([item({ action: "retry", questionId: undefined }), item({ entityId: "pr:acme/app#1", taskId: undefined, questionId: undefined, action: "open" })], "CCHANNEL");
    expect(message.text).toContain("Open in DevHub to act on these items");
    expect(message.text).not.toContain("your answer");
  });
});

describe("ready for review progress message", () => {
  it("posts the request people forward, with the repo as code and both links", () => {
    const message = formatSlackProgress({ profile: "work", taskId: "t1", title: "PTF-1 · Match header colours", kind: "ready-for-review", runId: "i1", key: "k", url: "https://github.com/acme/app/pull/9", repo: "acme/app", jira: ["PTF-1"] }, "C1", "1.1");
    const text = JSON.stringify(message.blocks);
    expect(text).toContain("PR ready for `app` - PTF-1 Match header colours");
    expect(text).toContain("PR: <https://github.com/acme/app/pull/9|app#9>");
    expect(text).toMatch(/JIRA: <https:\/\/[^|>]+\/browse\/PTF-1\|PTF-1>/);
    expect(text).toContain("JIRA: ");
    expect(message.blocks?.some((block) => block.type === "actions")).toBe(true);
  });
});

describe("choice buttons", () => {
  it("ask for confirmation, so a stray click does not answer", () => {
    const task = { profile: "work", entityId: "task:t", taskId: "t", questionId: "q1", itemKey: "q1", title: "PTF-1 · Task", needed: "Which?", action: "answer", href: "/storyboard?task=t", channel: "C1", options: ["Deliver US only", "Wait"] } as never;
    const blocks = formatSlackNeed(task, "item-id", "C1").blocks as Array<{ type: string; elements?: Array<{ action_id: string; confirm?: unknown }> }>;
    const choices = blocks.filter((block) => block.type === "actions").flatMap((block) => block.elements ?? []).filter((element) => element.action_id.startsWith("devhub_answer_option_"));
    expect(choices).toHaveLength(2);
    expect(choices.every((choice) => choice.confirm)).toBe(true);
  });
});
