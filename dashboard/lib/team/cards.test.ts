import { describe, expect, it } from "vitest";
import { HANDOFF_DECLINE_ACTION, HANDOFF_PICKUP_ACTION } from "@shared/slack-gateway/protocol";
import { askCard, handedToCard, handoffConfirmCard, receiverCard, safeTeamText, suggestionCard, teamTaskActions } from "./cards";
import type { TeamBundle } from "./store";

const title = "APP-42 Keep saved articles available offline";
const question = "Keep cached articles for seven days?";
const branch = "devhub/app-42-offline-cache";
const prUrl = "https://github.com/acme/app/pull/42";
const note = [title, "Ticket: APP-42", "Plan: Add an offline article cache.", "Last run: Cache implementation complete.", "Branch: " + branch, "PR: " + prUrl, "Question: " + question].join("\n\n");
const bundle: TeamBundle = { version: 1, handoffId: "11111111-1111-4111-8111-111111111111", title, repo: "github.com/acme/app", branch, prUrl, jiraKey: "APP-42", reassignJira: true };
const context = ["*Task*\n" + title, "*Ticket*\nAPP-42", "*Plan*\nAdd an offline article cache.", "*Last run*\nCache implementation complete.", "*Question*\n" + question];
const cards = {
  "ask-channel": askCard(context, "CTEAM"), "ask-group-dm": askCard(context),
  "suggested-answer": suggestionCard("D1", "maya", question, "Yes, keep cached articles for seven days.", "suggestion-token"),
  "handoff-confirm-clean": handoffConfirmCard("D1", "maya", [], "handoff-token", true, true),
  "handoff-confirm-dirty": handoffConfirmCard("D1", "maya", ["src/offline-cache.ts"], "handoff-token", true, false),
  receiver: receiverCard(bundle, "john", note), "handing-to": handedToCard("D1", "maya", false), "handed-to": handedToCard("D1", "maya", true),
};

describe("team Slack card presentation", () => {
  it.each(Object.entries(cards))("%s has a title, context hints and bounded blocks", (_name, card) => {
    expect(card.blocks![0].type).toBe("header");
    expect(card.blocks!.some((block) => block.type === "context")).toBe(true);
    expect(card.blocks!.length).toBeLessThanOrEqual(50); expect(card.text.length).toBeGreaterThan(0);
    for (const block of card.blocks!) {
      if (block.type === "header") expect(block.text.text.length).toBeLessThanOrEqual(150);
      if (block.type === "section" && block.text) expect(block.text.text.length).toBeLessThanOrEqual(3000);
    }
  });
  it("puts the question before the task context and keeps channel/DM reply hints", () => {
    const first = cards["ask-channel"].blocks[1];
    expect(first.type === "section" && first.text?.text).toBe("*Question*\n" + question);
    expect(JSON.stringify(cards["ask-channel"].blocks)).toContain("Reply in this thread");
    expect(JSON.stringify(cards["ask-group-dm"].blocks)).toContain("Reply here");
  });
  it("preserves suggestion controls and expired-question guidance", () => {
    const actions = cards["suggested-answer"].blocks!.flatMap((block) => block.type === "actions" ? block.elements : []);
    expect(actions.map((action) => action.action_id)).toEqual(["devhub_team_send", "devhub_team_edit", "devhub_team_dismiss"]);
    expect(actions.every((action) => action.type === "button" && action.value === "suggestion-token")).toBe(true);
    expect(JSON.stringify(suggestionCard("D1", "maya", question, "Answer"))).toContain("Nothing was sent to the agent");
  });
  it("preserves clean/dirty confirmation semantics and Jira controls", () => {
    for (const [name, label] of [["handoff-confirm-clean", "Push and hand off"], ["handoff-confirm-dirty", "Commit WIP and push"]] as const) {
      const actions = cards[name].blocks!.flatMap((block) => block.type === "actions" ? block.elements : []);
      expect(actions).toContainEqual(expect.objectContaining({ action_id: "devhub_team_confirm", value: "handoff-token", style: "danger", text: { type: "plain_text", text: label } }));
      expect(actions).toContainEqual(expect.objectContaining({ action_id: "devhub_team_jira" }));
      expect(actions).toContainEqual(expect.objectContaining({ action_id: "devhub_team_cancel", value: "handoff-token" }));
    }
  });
  it("preserves the exact handoff note and bundle used by gateway pickup", () => {
    const message = receiverCard(bundle, "john", note);
    const noteBlocks = message.blocks.filter((block) => block.type === "section" && block.block_id?.startsWith("team_handoff_note_"));
    expect(noteBlocks.map((block) => block.type === "section" ? block.text?.text : "").join("")).toBe(note);
    const actions = message.blocks.flatMap((block) => block.type === "actions" ? block.elements : []);
    expect(actions).toContainEqual(expect.objectContaining({ action_id: HANDOFF_PICKUP_ACTION, value: JSON.stringify(bundle) }));
    expect(actions).toContainEqual(expect.objectContaining({ action_id: HANDOFF_DECLINE_ACTION, value: bundle.handoffId }));
    expect(teamTaskActions("task-42")[0].block_id).toBe("team_task_task-42");
  });
  it("strips mentions and mass pings without losing ordinary helper names", () => {
    expect(safeTeamText("<@U1> <!here> @here @channel @everyone <tag> & @maya")).toBe("     &lt;tag&gt; &amp; @maya");
    expect(JSON.stringify(askCard(["*Question*\n<@U1> <!here> @here keep it?"], "CTEAM"))).not.toContain("<@U1>");
  });
  it("keeps the existing oversized context and note guards", () => {
    expect(() => askCard(Array.from({ length: 46 }, () => "Details"))).toThrow("too long for Slack");
    expect(() => receiverCard(bundle, "john", "x".repeat(28801))).toThrow("too long for Slack");
    expect(() => receiverCard({ ...bundle, title: "x".repeat(2000) }, "john", note)).toThrow("too large for Slack");
    const large = receiverCard(bundle, "john", "x".repeat(28800));
    expect(large.blocks.length).toBeLessThanOrEqual(50);
    expect(handoffConfirmCard("D1", "maya", Array.from({ length: 100 }, () => "x".repeat(3000)), "token", false, false).blocks!.length).toBeLessThanOrEqual(50);
  });
});
