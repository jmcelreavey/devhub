import { describe, expect, it } from "vitest";
import { ageLabel, buildPrSections, ciDot, formatPrCard, formatPrMore, PR_MORE_LIMIT, PR_SECTION_LIMIT, type SlackPrData } from "./pr-view";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const pr = (number: number, patch: Record<string, unknown> = {}) => ({ number, title: `PR ${number}`, url: `https://github.com/acme/app/pull/${number}`, repo: "acme/app", createdAt: "2026-10-15T12:00:00Z", checks: "passing" as const, author: { login: "sam" }, ...patch });
const data = (patch: Partial<SlackPrData> = {}): SlackPrData => ({ configured: true, authored: [], reviews: [], owned: [], ownedFailed: [], stale: false, ...patch });

describe("CI dot and age", () => {
  it.each([["passing", "🟢"], ["failing", "🔴"], ["pending", "🟡"], ["none", "⚪"], [undefined, "⚪"]] as const)("%s → %s", (checks, dot) => expect(ciDot(checks)).toBe(dot));
  it.each([
    ["2026-10-18T11:59:30Z", "1m"], ["2026-10-18T11:15:00Z", "45m"], ["2026-10-18T07:00:00Z", "5h"], ["2026-10-15T12:00:00Z", "3d"], ["2026-10-18T13:00:00Z", undefined], [undefined, undefined], ["junk", undefined],
  ])("%s → %s", (iso, label) => expect(ageLabel(iso, NOW)).toBe(label));
});

describe("buildPrSections", () => {
  it("lists a PR once: mine, then review requested without my own, then owned without either", () => {
    const sections = buildPrSections(data({ authored: [pr(1)], reviews: [pr(1), pr(2)], owned: [pr(1), pr(2), pr(3)] }), NOW);
    expect(sections.mine.map((row) => row.title)).toEqual(["PR 1"]);
    expect(sections.review.map((row) => row.title)).toEqual(["PR 2"]);
    expect(sections.owned.map((row) => row.title)).toEqual(["PR 3"]);
  });
  it("drops closed and merged review requests, as Home and the PRs page do", () => {
    const sections = buildPrSections(data({ reviews: [pr(1, { prState: "merged" }), pr(2, { prState: "closed" }), pr(3, { prState: "open" })] }), NOW);
    expect(sections.review.map((row) => row.title)).toEqual(["PR 3"]);
  });
  it("puts failing CI first in each section and keeps the source order otherwise", () => {
    const sections = buildPrSections(data({ authored: [pr(1), pr(2, { checks: "failing" }), pr(3), pr(4, { checks: "failing" })] }), NOW);
    expect(sections.mine.map((row) => row.title)).toEqual(["PR 2", "PR 4", "PR 1", "PR 3"]);
  });
  it("shows the author on the others but not on mine, and the age and dot on every row", () => {
    const sections = buildPrSections(data({ authored: [pr(1)], reviews: [pr(2)] }), NOW);
    expect(sections.mine[0]).toMatchObject({ author: undefined, age: "3d", dot: "🟢" });
    expect(sections.review[0]).toMatchObject({ author: "sam", age: "3d" });
  });
  it("shows an unknown CI state as ⚪ rather than guessing green", () => {
    expect(buildPrSections(data({ authored: [pr(1, { checks: undefined })] }), NOW).mine[0].dot).toBe("⚪");
  });
});

describe("formatPrCard", () => {
  const many = (count: number, patch: Record<string, unknown> = {}) => Array.from({ length: count }, (_, i) => pr(i + 1, patch));
  it("stays inside Slack's block limit with five rows in each of three sections, and keeps one primary action", () => {
    const d = data({ authored: many(9), reviews: many(9).map((row) => ({ ...row, number: row.number + 100 })), owned: many(9).map((row) => ({ ...row, number: row.number + 200 })) });
    const message = formatPrCard({ sections: buildPrSections(d, NOW), data: d, channel: "C", moreIds: { mine: "a", review: "b", owned: "c" } });
    expect(message.blocks!.length).toBeLessThanOrEqual(50);
    const buttons = message.blocks!.flatMap((block) => block.type === "actions" ? block.elements : []) as Array<{ text: { text: string }; style?: string }>;
    expect(buttons.filter((button) => button.style === "primary").map((button) => button.text.text)).toEqual(["Open in DevHub"]);
    expect(buttons.filter((button) => /^Show more/.test(button.text.text))).toHaveLength(3);
    expect(message.text).toContain("Pull requests · 27");
  });
  it("offers Show more only for sections with hidden rows, and says how many are hidden", () => {
    const d = data({ authored: many(PR_SECTION_LIMIT), reviews: many(PR_SECTION_LIMIT + 2).map((row) => ({ ...row, number: row.number + 100 })) });
    const message = formatPrCard({ sections: buildPrSections(d, NOW), data: d, channel: "C", moreIds: { mine: "a", review: "b" } });
    const body = JSON.stringify(message.blocks);
    expect(body).toContain("Show more review requested");
    expect(body).not.toContain("Show more mine");
    expect(body).toContain("+2 more");
  });
  it("escapes titles so they can't mention or link anywhere", () => {
    const d = data({ authored: [pr(1, { title: "<!channel> & <https://evil.test|click>" })] });
    const body = JSON.stringify(formatPrCard({ sections: buildPrSections(d, NOW), data: d, channel: "C", moreIds: {} }).blocks);
    expect(body).not.toContain("<!channel>");
    expect(body).toContain("&lt;!channel&gt;");
  });
  it("has an honest empty state per section", () => {
    const d = data();
    const text = JSON.stringify(formatPrCard({ sections: buildPrSections(d, NOW), data: d, channel: "C", moreIds: {} }).blocks);
    expect(text).toContain("No open PRs of yours.");
    expect(text).toContain("Nothing waiting for your review.");
  });
  it("notes when GitHub was slow", () => {
    const d = data({ stale: true });
    expect(JSON.stringify(formatPrCard({ sections: buildPrSections(d, NOW), data: d, channel: "C", moreIds: {} }).blocks)).toContain("last list DevHub had");
  });
});

describe("formatPrMore", () => {
  it("posts rows six onwards and caps one reply, pointing at DevHub for the rest", () => {
    const rows = buildPrSections(data({ authored: Array.from({ length: PR_SECTION_LIMIT + PR_MORE_LIMIT + 4 }, (_, i) => pr(i + 1)) }), NOW).mine;
    const message = formatPrMore({ id: "mine", rows, channel: "C", threadTs: "1.1" });
    expect(message.thread_ts).toBe("1.1");
    expect(message.blocks!.length).toBeLessThanOrEqual(50);
    expect(message.text).toContain("PR 6");
    expect(message.text).not.toContain("PR 5\n");
    expect(JSON.stringify(message.blocks)).toContain("+4 more");
  });
});
