import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commandRule } from "./ticket-args";
import { routeSlackMessage } from "./router";
import { SlackToolRouter, type SlackToolContext } from "./tool-handler";
import { ToolConfirmStore } from "./tool-confirm-store";
import type { SlackTool } from "./mcp-catalog";
import type { SlackInteraction } from "./security";
import { slackToolRisk } from "./tool-risk";
import { toSlackTool } from "./mcp-catalog";

const tool: SlackTool = { name: "task_note_add", category: "task", description: "Save owner note", readOnly: false, destructive: false, inputSchema: { type: "object", required: ["id", "text"], properties: { id: { type: "string" }, text: { type: "string" }, noteId: { type: "string" }, updateAgent: { type: "boolean" } } } };
const context: SlackToolContext = { profile: "work", userId: "U1", teamId: "T1", channel: "C1", threadTs: "1.1" };
let root: string | undefined;
afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });
function setup(running = false) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "task-note-slack-"));
  const call = vi.fn(async (_profile: string, _name: string, args: Record<string, unknown>) => ({ text: "Note saved", isError: false, structuredContent: { saved: true, target: args.id, note: { id: "n1", text: args.text, at: "2026-10-19T10:00:00Z" }, capability: { running }, agent: { mode: args.updateAgent ? "followup" : "none" } } }));
  const jev = vi.fn(); const model = vi.fn();
  const router = new SlackToolRouter({ catalog: { tools: async () => [tool], call, close: async () => {} }, confirms: new ToolConfirmStore(root), jev, model, record: vi.fn(), totals: vi.fn() });
  return { router, call, jev, model };
}
describe("Slack owner notes", () => {
  it.each(["note PTF-1 foo", "note PTF-1: foo", "add note to PTF-1: foo", "note 11111111-1111-4111-8111-111111111111 foo"])("recognises %s", (message) => {
    expect(commandRule(message)).toMatchObject({ kind: "tool", tool: "task_note_add", args: { text: "foo" } });
    expect(routeSlackMessage(message, { activeProfile: "work", profiles: ["work"] }).kind).toBe("unknown");
  });
  it.each(["notes", "what notes", "note", "note PTF-1", "note PTF-1:"])("does not recognise %s as a save", (message) => expect(commandRule(message)).toBeNull());
  it("preserves case, punctuation and newlines in the owner's input", () => expect(commandRule("note PTF-1 Keep It.\nDon't change API!" )).toMatchObject({ args: { text: "Keep It.\nDon't change API!" } }));
  it("saves immediately without a Confirm card, Jev or a model", async () => {
    const { router, call, jev, model } = setup(); const [reply] = await router.handle("note PTF-1 foo", context);
    expect(call).toHaveBeenCalledWith("work", "task_note_add", { id: "PTF-1", text: "foo" });
    expect(reply.text).toBe("📝 Note saved to PTF-1"); expect(JSON.stringify(reply)).not.toContain("devhub_tool_confirm");
    expect(jev).not.toHaveBeenCalled(); expect(model).not.toHaveBeenCalled();
  });
  it("updates only after a single-use owner-bound button click and reuses the saved note", async () => {
    const { router, call } = setup(true); const [reply] = await router.handle("note PTF-1 foo", context);
    const blocks = reply.blocks as Array<{ type: string; elements?: Array<{ action_id: string; value: string; text: { text: string } }> }>;
    const button = blocks.find((block) => block.type === "actions")!.elements![0];
    expect(button.text.text).toBe("Update the agent too"); expect(call).toHaveBeenCalledTimes(1);
    const click = { action: button.action_id, value: button.value, teamId: "T1", userId: "U1", channelId: "C1", ts: "1.1", actionTs: "2.1" } as SlackInteraction;
    await router.interact({ ...click, userId: "NOT_OWNER" }); expect(call).toHaveBeenCalledTimes(1);
    const result = await router.interact(click);
    expect(call).toHaveBeenLastCalledWith("work", "task_note_add", { id: "PTF-1", text: "foo", noteId: "n1", updateAgent: true });
    expect(result.post[0].text).toContain("Agent updated");
    await router.interact(click); expect(call).toHaveBeenCalledTimes(2);
  });
  it("classifies save as harmless but an agent update as a write", () => {
    expect(slackToolRisk(tool, {})).toEqual({ confirm: false, destructive: false });
    expect(slackToolRisk(tool, { updateAgent: true })).toEqual({ confirm: true, destructive: false });
    expect(toSlackTool({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, annotations: { readOnlyHint: false, destructiveHint: false } })).toMatchObject({ name: "task_note_add", readOnly: false, destructive: false });
  });
});
