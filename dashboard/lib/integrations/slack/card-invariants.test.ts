import { buildCapabilitiesOverview, buildCapabilitiesPage } from "./capabilities-format";
import { describe, expect, it } from "vitest";
import type { KnownBlock } from "@slack/web-api";
import { formatSlackAnswer, formatSlackCard, slackOpenButton, slackTextMessage } from "./format";
import { formatPrCard, formatPrMore, type PrSections, type SlackPrData } from "./pr-view";
import { formatCalendarDay, formatNextMeeting } from "./calendar-view";
import { formatWorktreeList, formatWorktreePreview, type WorktreeRow } from "./worktree-view";
import { formatChoiceCard, formatConfirmCard, formatPickCard, formatSettledCard, formatTooLargeCard, formatToolResult } from "./tool-format";
import { compactPrNeedBlocks, formatPlanRevisionModal, formatSlackAnswerConfirmation, formatSlackDigest, formatSlackNeed, formatSlackProgress, formatSlackRetryConfirmation, formatSlackTaskRoot } from "./needs-you-format";
import { buildHomeView, buildPrivateHomeView } from "./home-view";
import { allowedSlackInteraction } from "./security";
import type { SlackThreadItem } from "./thread-store";
import { askCard, suggestionCard, handoffConfirmCard, receiverCard, handedToCard, teamTaskActions } from "@/lib/team/cards";

const channel = "C1";
const tool = { name: "notes_write", description: "Write note", inputSchema: {}, readOnly: false, destructive: false, category: "notes" };
const item: SlackThreadItem = { profile: "work", entityId: "task:one", taskId: "one", itemKey: "question", title: "Task", needed: "Choose a repo", action: "answer", href: "/work", teamId: "T1", userId: "U1", channel, thread_ts: "1.1", postedAt: "2026-10-19T00:00:00Z", resolved: false, delivery: "sent", dirty: false };
const grouped = { ...item, taskId: undefined, prRows: [{ title: "Review PR", href: "https://github.com/acme/app/pull/1", needed: "Review requested" }] };
const plan: SlackThreadItem = { ...item, title: "APP-42 · Keep saved articles available offline", action: "approve-plan", state: "plan-ready", plan: { runId: "run-offline", fingerprint: "plan-one", summary: "Cache saved articles on device, refresh them when online, and test offline reads." } };
const rows = Array.from({ length: 8 }, (_, index) => ({ dot: "🔴", title: `PR ${index}`, url: `https://github.com/acme/app/pull/${index}`, repo: "acme/app", failing: true }));
const sections: PrSections = { mine: rows, review: rows, owned: rows };
const data: SlackPrData = { configured: true, stale: false, authored: [], reviews: [], owned: [], ownedFailed: [] };
const calendar = { state: "ok" as const, events: [{ id: "one", title: "Meeting", start: "2026-10-19T10:00:00Z", end: "2026-10-19T11:00:00Z", isAllDay: false, conferenceUrl: "https://meet.google.com/abc", htmlLink: "https://calendar.google.com/abc" }] };
const worktree: WorktreeRow = { repo: "app", path: "/tmp/worktree", branch: "feature", state: "clean", reason: "PR merged" };
const cards: Record<string, { blocks?: KnownBlock[] }> = {
  capabilities: buildCapabilitiesOverview({ channel, deviceLabel: "Mac", tools: Array.from({ length: 60 }, (_, index) => ({ ...tool, name: "tool_" + index, category: "custom-" + index })) }),
  tools: buildCapabilitiesPage({ channel, deviceLabel: "Mac", tools: Array.from({ length: 40 }, (_, index) => ({ ...tool, name: "tool_" + index })) }, { view: "tools", page: 0 }),
  capabilitiesUnavailable: buildCapabilitiesOverview({ channel, deviceLabel: "Mac" }),
  teamAsk: askCard(["Question"], "C1"),
  teamSuggestion: suggestionCard(channel, "helper", "Question", "Answer", "token"),
  teamCleanConfirm: handoffConfirmCard(channel, "helper", [], "token", true, true),
  teamDirtyConfirm: handoffConfirmCard(channel, "helper", ["file.ts"], "token", true, false),
  teamReceiver: receiverCard({ version: 1, handoffId: "11111111-1111-4111-8111-111111111111", title: "Task", repo: "github.com/org/app", branch: "feature/task", reassignJira: true }, "owner", "Full note"),
  teamHanded: handedToCard(channel, "helper", true),
  teamControls: { blocks: teamTaskActions("one") },
  card: formatSlackCard({ title: "Card", sections: [{ items: [{ title: "Task", href: "/work" }] }], href: "/work" }, channel),
  answer: formatSlackAnswer({ kind: "tasks", profile: "work", title: "Tasks", lines: [], more: 0, href: "/work" }, channel),
  text: slackTextMessage(channel, "Text"),
  open: { blocks: [slackOpenButton("https://example.test/")] },
  prs: formatPrCard({ sections, data, channel, moreIds: { mine: "mine", review: "review", owned: "owned" } }),
  prMore: formatPrMore({ id: "review", rows, channel }),
  calendar: formatCalendarDay({ data: calendar, day: "2026-10-19", channel }),
  meeting: formatNextMeeting({ data: calendar, now: Date.parse("2026-10-19T09:00:00Z"), channel }),
  worktrees: formatWorktreeList({ view: { rows: [worktree], kept: 0, failedRepos: [] }, channel, cleanId: "clean" }),
  cleanup: formatWorktreePreview({ preview: { removable: [worktree], skipped: [] }, rows: [worktree], channel, confirmId: "confirm" }),
  result: formatToolResult({ tool: tool.name, text: "Done", channel, profile: "work" }),
  confirm: formatConfirmCard({ tool, args: { path: "note" }, id: "id", channel, profile: "work" }),
  danger: formatConfirmCard({ tool, args: {}, destructive: true, id: "id", channel, profile: "work" }),
  tooLarge: formatTooLargeCard({ tool, channel, profile: "work" }),
  settled: formatSettledCard(channel, "Cancelled"),
  choice: formatChoiceCard({ title: "Choose", hint: "Pick one", choices: [{ label: "One", id: "one" }, { label: "Two", id: "two", pick: true }], channel }),
  pick: formatPickCard({ choices: [{ tool, id: "one" }, { tool, id: "two" }], channel }),
  need: formatSlackNeed(item, "id", channel),
  planReady: formatSlackNeed(plan, "id", channel),
  planReadyLong: formatSlackNeed({ ...plan, title: "A".repeat(500), plan: { ...plan.plan!, summary: "Long plan ".repeat(500) } }, "id", channel),
  planResolved: formatSlackNeed(plan, "id", channel, undefined, "Plan approved in DevHub"),
  planTeam: formatSlackNeed(plan, "id", "D1", undefined, undefined, true),
  planRevisionModal: formatPlanRevisionModal(plan, "id", "token"),
  startable: formatSlackNeed({ ...item, action: "open" }, "id", channel),
  retry: formatSlackNeed({ ...item, action: "retry" }, "id", channel),
  prNeeds: formatSlackNeed(grouped, "id", channel),
  compactPr: { blocks: compactPrNeedBlocks(grouped) },
  digest: formatSlackDigest([item, grouped], channel),
  retryConfirm: formatSlackRetryConfirmation(item, "token"),
  answerConfirm: formatSlackAnswerConfirmation(channel, "1.1", "token", ["My answer"]),
  progress: formatSlackProgress({ kind: "plan-ready", taskId: "one", profile: "work", title: "Task", key: "plan", runId: "run-one" }, channel, "1.1"),
  root: formatSlackTaskRoot({ taskId: "one", profile: "work", title: "Task" }, channel),
  home: buildHomeView({ profile: "work", channel, needs: [{ id: "answer", need: item }, { id: "start", need: { ...item, action: "open" } }, { id: "retry", need: { ...item, action: "retry" } }, { id: "prs", need: grouped }], tasks: [], prs: { configured: true, stale: false, sections }, now: Date.now() }),
  privateHome: buildPrivateHomeView(),
};

describe("all Slack card builders", () => {
  it.each(Object.entries(cards))("%s stays within Block Kit limits", (name, card) => {
    expect(card.blocks?.length ?? 0).toBeLessThanOrEqual(name === "home" ? 100 : 50);
    for (const block of card.blocks ?? []) {
      if (block.type === "header") expect(block.text.text.length).toBeLessThanOrEqual(150);
      if (block.type === "section" && block.text) expect(block.text.text.length).toBeLessThanOrEqual(3000);
      if (block.type === "input" && block.element.type === "plain_text_input") {
        expect(block.element.max_length ?? 3000).toBeLessThanOrEqual(3000);
        expect(block.element.min_length ?? 0).toBeLessThanOrEqual(3000);
      }
      if (block.type !== "actions") continue;
      expect(block.elements.length).toBeLessThanOrEqual(25);
      for (const element of block.elements) {
        if (element.type !== "button") continue;
        expect(element.text.text.length).toBeLessThanOrEqual(75);
        expect(element.value?.length ?? 0).toBeLessThanOrEqual(2000);
        expect(element.url?.length ?? 0).toBeLessThanOrEqual(3000);
      }
    }
  });
  it.each(Object.entries(cards))("%s has unique, allowlisted action IDs in every actions block", (_name, card) => {
    for (const block of card.blocks ?? []) {
      if (block.type !== "actions") continue;
      const ids = block.elements.map((element) => element.action_id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(block.elements.filter((element) => "style" in element && element.style === "primary").length).toBeLessThanOrEqual(1);
      for (const action_id of ids) expect(allowedSlackInteraction({ type: "block_actions", team: { id: "T1" }, user: { id: "U1" }, channel: { id: channel }, container: { type: "message", channel_id: channel, message_ts: "1.1" }, message: { ts: "1.1" }, actions: [{ type: "button", action_id, action_ts: "2.1" }] }, { botToken: "", appToken: "", teamId: "T1", allowedUserId: "U1", channelId: channel }, { userId: "UBOT", teamId: "T1", name: "DevHub" })).not.toBeNull();
    }
  });
});
