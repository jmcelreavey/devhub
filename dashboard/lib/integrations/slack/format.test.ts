import { describe, expect, it } from "vitest";
import { formatSlackAnswer, formatSlackCard, slackDashboardBaseUrl, slackLink, slackTextMessage } from "./format";
import type { SlackAnswer } from "./answers";

const answer: SlackAnswer = { kind: "tasks", profile: "work", title: "Needs you", lines: ["PTF-123 · Check this\nNext: Answer"], more: 0, href: "/storyboard?task=123&profile=work" };
describe("Slack reply formatting", () => {
  it("uses Block Kit and exactly one local Open in DevHub button", () => {
    const message = formatSlackAnswer(answer, "CCHANNEL", "http://localhost:1337");
    expect(message).toMatchObject({ channel: "CCHANNEL", mrkdwn: false, unfurl_links: false, unfurl_media: false });
    const actions = message.blocks?.filter((block) => block.type === "actions");
    expect(actions).toEqual([{ type: "actions", elements: [{ type: "button", action_id: "devhub_open", text: { type: "plain_text", text: "Open in DevHub" }, style: "primary", url: "http://localhost:1337/storyboard?task=123&profile=work" }] }]);
  });
  it("caps task lines at six and shows the actual remainder without flooding Slack", () => {
    const message = formatSlackAnswer({ ...answer, lines: Array.from({ length: 12 }, () => "Task ".repeat(200)), more: 4 }, "CCHANNEL", "http://localhost:1337");
    expect(message.blocks?.filter((block) => block.type === "section")).toHaveLength(6);
    expect(message.text).toContain("+10 more in DevHub");
    expect(message.blocks?.length).toBe(10);
  });
  it("keeps single-task metadata local for reaction mapping and never maps a multi-task card", () => {
    const taskRef = { profile: "work", taskId: "t1", title: "A task" };
    expect(formatSlackAnswer({ ...answer, total: 1, taskRef }, "CCHANNEL").taskRef).toEqual(taskRef);
    expect(formatSlackAnswer({ ...answer, total: 2, taskRef }, "CCHANNEL").taskRef).toBeUndefined();
  });
  it("keeps task text literal and prevents mentions or Slack links in fallback text", () => {
    const message = formatSlackAnswer({ ...answer, lines: ["<@UOTHER> <!channel> & <https://evil.test|click>"] }, "CCHANNEL");
    expect(message.blocks?.find((block) => block.type === "section")).toMatchObject({ text: { type: "mrkdwn", text: "&lt;@UOTHER&gt; &lt;!channel&gt; &amp; &lt;https://evil.test¦click&gt;", verbatim: true } });
    expect(message.text).toContain("&lt;@UOTHER&gt;");
    expect(message.text).not.toContain("<!channel>");
  });
  it("keeps all Slack limits, the next action and the footer under hostile long input", () => {
    const message = formatSlackCard({
      title: "A very long header ".repeat(100), profile: "work", href: "/prs", footer: "Reply here to continue.",
      sections: Array.from({ length: 20 }, (_, section) => ({ title: `Group ${section}`, items: Array.from({ length: 200 }, (_, index) => ({ title: "<&> ".repeat(2000), href: `https://example.com/pr/${index}`, status: "✅ passing", meta: "<&> ".repeat(2000) })) })),
    }, "CCHANNEL", "1.1", "http://localhost:1337");
    expect(message.blocks!.length).toBeLessThanOrEqual(50);
    expect(message.text.length).toBeLessThanOrEqual(4000);
    for (const block of message.blocks!) {
      if (block.type === "header") expect(block.text.text.length).toBeLessThanOrEqual(150);
      if (block.type === "section" && block.text) expect(block.text.text.length).toBeLessThanOrEqual(3000);
      if (block.type === "context") for (const element of block.elements) if ("text" in element) expect(element.text.length).toBeLessThanOrEqual(3000);
    }
    expect(message.blocks!.at(-1)).toMatchObject({ type: "actions", elements: [{ action_id: "devhub_open", style: "primary" }] });
    expect(JSON.stringify(message.blocks)).toContain("Reply here to continue.");
    expect(JSON.stringify(message.blocks)).toContain("+15 more sections");
  });
  it("bounds simple notices and provides a nonempty fallback", () => {
    expect(slackTextMessage("C", "").text).toBe("Done.");
    const message = slackTextMessage("C", "<>&".repeat(6000));
    expect(message.text.length).toBeLessThanOrEqual(4000);
    expect(message.blocks?.[0]).toMatchObject({ text: { text: expect.any(String) } });
    expect((message.blocks![0] as { text: { text: string } }).text.text.length).toBeLessThanOrEqual(3000);
  });
  it.each(["javascript:alert(1)", "https://user:password@example.com", `https://example.com/${"&".repeat(2000)}`])("does not turn an unsafe or oversized target into a link: %s", (href) => {
    expect(slackLink("A safe title", href)).toBe("A safe title");
  });
  it("escapes injected mentions, links and pipes in linked titles", () => {
    expect(slackLink("<!channel> <https://evil.test|click>", "/prs", "http://localhost:1337")).toBe("<http://localhost:1337/prs|&lt;!channel&gt; &lt;https://evil.test¦click&gt;>");
  });
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/\n/evil.test", "javascript:alert(1)"])("rejects non-DevHub action destinations: %s", (href) => {
    expect(JSON.stringify(formatSlackAnswer({ ...answer, href }, "CCHANNEL", "http://localhost:1337"))).toContain("http://localhost:1337/storyboard");
  });
  it("uses the configured dashboard URL, with a localhost default", () => {
    expect(slackDashboardBaseUrl({})).toBe("http://localhost:1337");
    expect(slackDashboardBaseUrl({ PORT: "1342" })).toBe("http://localhost:1342");
    expect(slackDashboardBaseUrl({ PORT: "99999" })).toBe("http://localhost:1337");
    expect(slackDashboardBaseUrl({ PORT: "0" })).toBe("http://localhost:1337");
    expect(slackDashboardBaseUrl({ DEVHUB_BASE_URL: "http://localhost:1350/path" })).toBe("http://localhost:1350");
    expect(slackDashboardBaseUrl({ DEVHUB_BASE_URL: "javascript:bad" })).toBe("http://localhost:1337");
    expect(slackDashboardBaseUrl({ DEVHUB_BASE_URL: "https://user:secret@host.test" })).toBe("http://localhost:1337");
  });
});
