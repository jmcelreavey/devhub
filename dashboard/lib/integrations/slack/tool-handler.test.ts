import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheapModelResult } from "./cheap-model";
import type { JevChoice, JevQuestion } from "./jev-choice";
import type { SlackTool } from "./mcp-catalog";
import type { SlackInteraction } from "./security";
import { ToolConfirmStore } from "./tool-confirm-store";
import { SlackToolRouter, type SlackToolContext, type ToolHandlerDeps } from "./tool-handler";
import { recordSlackUsage, slackUsageTotals } from "./usage-log";
import { slackTransportContext } from "./transport-context";
import { normalizeSlackCommand } from "./slack-text";
import { parseCapabilityPage } from "./capabilities-format";

const context: SlackToolContext = { profile: "work", channel: "CCHANNEL", threadTs: "1.1", teamId: "TTEAM", userId: "UOWNER" };
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-tools-")); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function tool(name: string, extra: Partial<SlackTool> & { required?: string[]; properties?: Record<string, unknown> } = {}): SlackTool {
  const { required = [], properties = {}, ...rest } = extra;
  return { name, description: `${name} description`, readOnly: true, destructive: false, category: name.split("_")[0], inputSchema: { type: "object", properties, required }, ...rest };
}

/** Jev stub: each pick names the option to choose; the rest of the probability is spread evenly. */
function jevPicks(...picks: Array<string | [string, number] | ((q: JevQuestion) => string)>) {
  let index = 0;
  return vi.fn(async (question: JevQuestion): Promise<JevChoice> => {
    const pick = picks[index++];
    const [raw, confidence = 0.9] = typeof pick === "function" ? [pick(question)] : Array.isArray(pick) ? pick : [pick];
    expect(question.options.map((option) => option.id)).toContain(raw);
    const rest = (1 - confidence) / Math.max(1, question.options.length - 1);
    return { id: raw, confidence, costUsd: 0.0001, probabilities: Object.fromEntries(question.options.map((option) => [option.id, option.id === raw ? confidence : rest])) };
  });
}

function build(tools: SlackTool[], overrides: { jev?: ReturnType<typeof jevPicks>; model?: ReturnType<typeof vi.fn>; call?: ReturnType<typeof vi.fn>; findTasks?: ToolHandlerDeps["findTasks"]; loadPrs?: ToolHandlerDeps["loadPrs"]; loadCalendar?: ToolHandlerDeps["loadCalendar"]; now?: number; answerModel?: ToolHandlerDeps["answerModel"]; answerTiers?: ToolHandlerDeps["answerTiers"] } = {}) {
  const call = overrides.call ?? vi.fn(async (_profile: string, name: string) => ({ text: JSON.stringify({ ran: name }), isError: false }));
  const jev = overrides.jev ?? jevPicks();
  const model = overrides.model ?? vi.fn(async (): Promise<CheapModelResult> => ({ ok: false, reason: "no-cheap-tier" }));
  const confirms = new ToolConfirmStore(root);
  const catalog = { tools: vi.fn(async () => tools), call: call as never, close: vi.fn(async () => {}) };
  const router = new SlackToolRouter({
    catalog,
    jev, model: model as never, answerModel: overrides.answerModel, answerTiers: overrides.answerTiers, confirms, record: (entry) => recordSlackUsage(entry, root), totals: () => slackUsageTotals(root), findTasks: overrides.findTasks,
    loadPrs: overrides.loadPrs, loadCalendar: overrides.loadCalendar, now: overrides.now === undefined ? undefined : () => overrides.now!,
  });
  return { router, call, jev, model, confirms, catalog };
}

const text = (message: { text?: string }) => message.text ?? "";
function interaction(action: string, value: string, patch: Partial<SlackInteraction> = {}): SlackInteraction {
  return { teamId: "TTEAM", userId: "UOWNER", channelId: "CCHANNEL", ts: "5.5", action, value, actionTs: "5.6", ...patch } as SlackInteraction;
}
function buttonValue(message: { blocks?: unknown[] }, action: string): string {
  const actions = (message.blocks as Array<{ type: string; elements?: Array<{ action_id: string; value?: string }> }>).find((block) => block.type === "actions");
  return actions!.elements!.find((element) => element.action_id === action)!.value!;
}

it("uses the existing Confirm path for gateway quick captures and reaction check-offs", async () => {
  const tools = [
    tool("tasks_capture", { readOnly: false, properties: { text: { type: "string" } }, required: ["text"] }),
    tool("tasks_update", { readOnly: false, properties: { id: { type: "string" }, date: { type: "string" }, status: { type: "string" } }, required: ["id"] }),
  ];
  const task = { taskId: "task-1", title: "A task", date: "2026-10-18", profile: "work" };
  const { router, call } = build(tools, { findTasks: vi.fn(async () => [task]) });
  await slackTransportContext.run({ deviceId: "device-one" }, async () => {
    expect(text((await router.handle("add task ship the gateway", context))[0])).toContain("Run tasks_capture");
    expect(text((await router.checkOff({ ...context, taskId: task.taskId }))[0])).toContain("Run tasks_update");
  });
  expect(call).not.toHaveBeenCalled();
});

describe("free capabilities", () => {
  it.each(["help", "commands", "what can you do?", "capabilities", "tools", "all tools", "list tools", "tools notes"])("loads the local catalog without a model: %s", async (phrase) => {
    const current = build([tool("notes_list"), tool("company_query", { plugin: "company" })]);
    const [message] = await current.router.handle(phrase + " in work", context);
    expect(current.catalog.tools).toHaveBeenCalledWith("work");
    expect(message.thread_ts).toBe("1.1");
    expect(message.text).toContain("2 tools");
    expect(current.jev).not.toHaveBeenCalled(); expect(current.model).not.toHaveBeenCalled(); expect(current.call).not.toHaveBeenCalled();
  });
  it("keeps the static overview and recovery hint when MCP is down", async () => {
    const current = build([]); current.catalog.tools.mockRejectedValue(new Error("MCP down"));
    const [message] = await current.router.handle("help", context);
    expect(message.text).toContain("couldn't be read"); expect(message.text).toContain("refresh tools");
    expect(current.jev).not.toHaveBeenCalled(); expect(current.model).not.toHaveBeenCalled();
  });
  it("keeps group, profile and parent thread on stateless More clicks", async () => {
    const current = build(Array.from({ length: 40 }, (_, index) => tool("notes_" + index)));
    const [message] = await current.router.handle("tools notes", context);
    const value = buttonValue(message, "devhub_tool_capabilities_0");
    expect(parseCapabilityPage(value)).toMatchObject({ group: expect.any(String), page: 1, profile: "work" });
    const result = await current.router.interact(interaction("devhub_tool_capabilities_0", value, { threadTs: "1.1", ts: "5.5" }));
    expect(result.post[0]).toMatchObject({ channel: "CCHANNEL", thread_ts: "1.1" });
    expect(result.post[0].text).toContain("2 of 3");
    expect(current.catalog.tools).toHaveBeenLastCalledWith("work");
    expect(current.jev).not.toHaveBeenCalled(); expect(current.model).not.toHaveBeenCalled();
  });
  it("rejects malformed clicks before reading tools or claiming confirmations", async () => {
    const current = build([]); const claim = vi.spyOn(current.confirms, "claim");
    const result = await current.router.interact(interaction("devhub_tool_capabilities_0", "invalid"));
    expect(result.post[0].text).toContain("not valid");
    expect(current.catalog.tools).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled();
  });
});

describe("direct tool rules (free)", () => {
  it.each(["prs", "meetings today", "what time is it", "what's the time?", "whats the time", "my assigned tasks"])("keeps bot-addressed %s on the free path", async (command) => {
    const { router, jev, model } = build([tool("jira_tickets")]);
    await router.handle(normalizeSlackCommand(`<@UBOT> ${command}`, "UBOT"), context);
    expect(jev).not.toHaveBeenCalled(); expect(model).not.toHaveBeenCalled();
  });
  it("calls a read-only tool without ever asking Jev or a model", async () => {
    const { router, call, jev, model } = build([tool("calendar_week"), tool("calendar_list")]);
    const [reply] = await router.handle("what's on my calendar this week?", context);
    expect(call).toHaveBeenCalledWith("work", "calendar_week", {});
    expect(text(reply)).toContain("Calendar · work");
    expect(jev).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    expect(slackUsageTotals(root)).toMatchObject({ queries: 1, rules: 1, jevCalls: 0, modelCalls: 0 });
  });
  it("fills a search query from the message and strips the profile scope", async () => {
    const { router, call } = build([tool("search", { required: ["query"], properties: { query: { type: "string" } } })]);
    await router.handle("search for deploy runbook in work", context);
    expect(call).toHaveBeenCalledWith("work", "search", { query: "deploy runbook" });
  });
  it("takes a keyword-selected write straight to Confirm without paying for Jev", async () => {
    const { router, call, jev } = build([tool("jobs_list", { readOnly: false, destructive: false }), tool("notes_list")]);
    const [card] = await router.handle("show me the jobs", context);
    expect(card.text).toContain("Run jobs_list");
    expect(call).not.toHaveBeenCalled();
    expect(jev).not.toHaveBeenCalled();
  });
  it("replies with today's cost from the usage log", async () => {
    const { router, call } = build([tool("notes_list")]);
    recordSlackUsage({ profile: "work", route: "jev", jevCalls: 2, jevCostUsd: 0.0004, modelCalls: 1 }, root);
    recordSlackUsage({ profile: "work", route: "rules", jevCalls: 0, jevCostUsd: 0, modelCalls: 0 }, root);
    const [reply] = await router.handle("what's the usage today?", context);
    expect(text(reply)).toContain("2 questions");
    expect(text(reply)).toContain("2 Jev calls ≈ $0.0004");
    expect(text(reply)).toContain("1 answer/argument model call");
    expect(call).not.toHaveBeenCalled();
  });
  it("refreshes the tool list on request", async () => {
    const tools = vi.fn(async () => [tool("a_one"), tool("b_two")]);
    const router = new SlackToolRouter({ catalog: { tools, call: vi.fn(), close: vi.fn() }, jev: jevPicks(), model: vi.fn(), confirms: new ToolConfirmStore(root), record: () => {}, totals: slackUsageTotals as never });
    const [reply] = await router.handle("refresh the tools", context);
    expect(tools).toHaveBeenCalledWith("work", true);
    expect(text(reply)).toContain("2 DevHub tools in 2 groups");
  });
});

describe("Jev routing", () => {
  const big = Array.from({ length: 300 }, (_, i) => tool(`group${i % 40}_tool${i}`, { category: `group${i % 40}` }));
  it("routes category first when the catalog is over the category threshold, then the tool, and records the cost", async () => {
    const jev = jevPicks("cat:group3", "tool:group3_tool3");
    const { router, call } = build(big, { jev });
    const [reply] = await router.handle("show the third group thing", context);
    const [first, second] = jev.mock.calls.map(([question]) => question);
    expect(first.options.length).toBeLessThanOrEqual(255);
    expect(first.options.some((option) => option.id.startsWith("cat:"))).toBe(true);
    expect(first.options.some((option) => option.id.startsWith("tool:"))).toBe(false);
    expect(second.options.filter((option) => option.id.startsWith("tool:")).every((option) => option.id.startsWith("tool:group3_"))).toBe(true);
    expect(call).toHaveBeenCalledWith("work", "group3_tool3", {});
    expect(text(reply)).toContain("group3_tool3");
    expect(slackUsageTotals(root)).toMatchObject({ jevCalls: 2, rules: 0 });
    expect(slackUsageTotals(root).jevCostUsd).toBeCloseTo(0.0002);
  });
  it("never offers more than 255 options in one Jev question", async () => {
    const huge = Array.from({ length: 400 }, (_, i) => tool(`one_tool${i}`, { category: "one" }));
    const jev = jevPicks("cat:one", "special:unsupported");
    await build(huge, { jev }).router.handle("do something obscure", context);
    expect(jev.mock.calls.every(([question]) => question.options.length <= 255)).toBe(true);
  });
  it("passes the profile and Jira key from rules into the chosen tool's arguments", async () => {
    const t = tool("zzz_lookup", { required: ["key"], properties: { key: { type: "string" }, profile: { type: "string" } } });
    const { router, call, model } = build([t], { jev: jevPicks("tool:zzz_lookup") });
    await router.handle("look up ptf-12 for me in personal", { ...context, profile: "personal" });
    expect(call).toHaveBeenCalledWith("personal", "zzz_lookup", { key: "PTF-12", profile: "personal" });
    expect(model).not.toHaveBeenCalled();
  });
  it("asks 'Did you mean…?' with up to three buttons on low confidence, and a pick still runs through the normal path", async () => {
    const { router, call } = build([tool("a_one"), tool("b_two"), tool("c_three"), tool("d_four")], { jev: jevPicks(["tool:a_one", 0.4]) });
    const [card] = await router.handle("hmm the thing", context);
    expect(text(card)).toBe("Did you mean…?");
    const buttons = (card.blocks as Array<{ elements?: unknown[] }>)[1].elements!;
    expect(buttons.length).toBeLessThanOrEqual(3);
    expect(call).not.toHaveBeenCalled();
    const id = buttonValue(card, "devhub_tool_pick_1");
    const reply = await router.interact(interaction("devhub_tool_pick_1", id));
    expect(reply.update?.text).toBe("Picked a_one.");
    expect(call).toHaveBeenCalledWith("work", "a_one", {});
  });
  it("asks when the top two are too close even if the top is confident enough", async () => {
    const jev = vi.fn(async (): Promise<JevChoice> => ({ id: "tool:a_one", confidence: 0.6, costUsd: 0, probabilities: { "tool:a_one": 0.6, "tool:b_two": 0.55, "special:answer": 0, "special:clarify": 0, "special:unsupported": 0 } }));
    const { router, call } = build([tool("a_one"), tool("b_two")], { jev });
    const [card] = await router.handle("which one", context);
    expect(text(card)).toBe("Did you mean…?");
    expect(call).not.toHaveBeenCalled();
  });
  it.each([
    ["special:unsupported", "isn't something DevHub can do"],
    ["special:clarify", "Did you mean PRs, tasks or notes"],
  ])("handles the %s option in plain words", async (pick, expected) => {
    const { router, call } = build([tool("a_one")], { jev: jevPicks(pick) });
    expect(text((await router.handle("blah", context))[0])).toContain(expected);
    expect(call).not.toHaveBeenCalled();
  });
  it("offers the thread to Jev only once there is one, and sends it to the model only when Jev picks it", async () => {
    const model = vi.fn(async (request: { prompt: string }): Promise<CheapModelResult> => ({ ok: true, text: `answer to: ${request.prompt.slice(-12)}`, label: "x" }));
    const jev = jevPicks("special:clarify", "special:thread", "special:clarify");
    const { router } = build([tool("a_one")], { jev, model });
    await router.handle("what is a monad", context);
    expect(jev.mock.calls[0][0].options.map((option) => option.id)).not.toContain("special:thread");
    expect(model.mock.calls[0][0].prompt).toBe("what is a monad");
    const [followUp] = await router.handle("why?", context);
    expect(jev.mock.calls[1][0].options.map((option) => option.id)).toContain("special:thread");
    expect(model.mock.calls[1][0].prompt).toContain("John: what is a monad");
    expect(model.mock.calls[1][0].prompt).toContain("DevHub: answer to:");
    expect(text(followUp)).toContain("answer to:");
    await router.handle("what is a functor", context);
    expect(model.mock.calls[2][0].prompt).toBe("what is a functor");
  });
  it("answers from DevHub data by searching it", async () => {
    const search = tool("search", { required: ["query"], properties: { query: { type: "string" } } });
    const { router, call } = build([tool("a_one"), search], { jev: jevPicks("special:answer") });
    await router.handle("what do my notes say about retries", context);
    expect(call).toHaveBeenCalledWith("work", "search", { query: "what do my notes say about retries" });
  });
  it("explains when Jev has no key, instead of failing silently", async () => {
    const jev = vi.fn(async () => { throw new Error("TYPESAFE_API_KEY is not configured."); });
    const { router } = build([tool("a_one")], { jev: jev as never });
    const [reply] = await router.handle("anything odd", context);
    expect(text(reply)).toContain("Jev) isn't connected");
    expect(JSON.stringify(reply.blocks)).toContain("/setup#jev");
    expect(JSON.stringify(reply.blocks)).not.toContain("TypeSafe");
  });
  it("offers free Did-you-mean buttons from the message words when Jev can't route", async () => {
    const jev = vi.fn(async () => { throw new Error("TYPESAFE_API_KEY is not configured."); });
    const calendar = tool("calendar_week", { description: "Meetings on the calendar this week" });
    const remove = tool("calendar_delete", { description: "Delete a calendar meeting", readOnly: false, destructive: true });
    const { router, call } = build([calendar, remove, tool("a_one")], { jev: jev as never });
    const [reply] = await router.handle("which calendar meetings clash", context);
    const blocks = JSON.stringify(reply.blocks);
    expect(blocks).toContain("devhub_tool_pick_1");
    expect(blocks).toContain("calendar week");
    expect(blocks).not.toContain("calendar delete");
    expect(call).not.toHaveBeenCalled();
  });
  it("still offers suggestions when TypeSafe itself is down", async () => {
    const jev = vi.fn(async () => { throw new Error("TypeSafe returned HTTP 503."); });
    const { router } = build([tool("a_one")], { jev: jev as never });
    const [reply] = await router.handle("anything odd", context);
    expect(text(reply)).toContain("isn't answering");
    expect(JSON.stringify(reply.blocks)).not.toContain("/setup#jev");
  });
  it("answers the time for free", async () => {
    const jev = vi.fn();
    const { router } = build([tool("a_one")], { jev: jev as never });
    expect(text((await router.handle("What time is it?", context))[0])).toMatch(/^It's \d\d:\d\d on /);
    expect(jev).not.toHaveBeenCalled();
  });
  it("reports a missing tool list without throwing", async () => {
    const router = new SlackToolRouter({ catalog: { tools: vi.fn(async () => { throw new Error("secret path /x"); }), call: vi.fn(), close: vi.fn() }, jev: jevPicks(), model: vi.fn(), confirms: new ToolConfirmStore(root), record: () => {}, totals: slackUsageTotals as never });
    const [reply] = await router.handle("something", context);
    expect(text(reply)).toContain("couldn't do that right now");
    expect(text(reply)).not.toContain("secret path");
  });
});

describe("writes need a button", () => {
  const writer = tool("notes_append", { readOnly: false, required: ["path"], properties: { path: { type: "string" } } });
  it("shows a confirm card with the tool and details, and does not run it", async () => {
    const t = tool("notes_append", { readOnly: false, required: ["key"], properties: { key: { type: "string" } } });
    const { router, call } = build([t], { jev: jevPicks("tool:notes_append") });
    const [card] = await router.handle("append to ptf-9", context);
    expect(text(card)).toContain("Run notes_append in work?");
    expect(text(card)).toContain("key: PTF-9");
    expect(text(card)).not.toContain("can't be undone");
    expect(call).not.toHaveBeenCalled();
  });
  it("says plainly that destructive tools can't be undone", async () => {
    const t = tool("notes_delete", { readOnly: false, destructive: true });
    const { router } = build([t], { jev: jevPicks("tool:notes_delete") });
    const [card] = await router.handle("delete the scratch note", context);
    expect(text(card)).toContain("This can't be undone.");
    const buttons = (card.blocks as Array<{ type: string; elements?: Array<{ style?: string }> }>).find((block) => block.type === "actions")!.elements!;
    expect(buttons[0].style).toBe("danger");
  });
  it("runs only on Confirm, exactly once, and settles the card", async () => {
    const { router, call } = build([tool("jobs_run", { readOnly: false })], { jev: jevPicks("tool:jobs_run") });
    const [card] = await router.handle("kick off the nightly", context);
    const id = buttonValue(card, "devhub_tool_confirm");
    const reply = await router.interact(interaction("devhub_tool_confirm", id));
    expect(call).toHaveBeenCalledTimes(1);
    expect(reply.update?.text).toBe("Confirmed. The result is in this thread.");
    expect(reply.update?.blocks?.every((block) => block.type !== "actions")).toBe(true);
    const again = await router.interact(interaction("devhub_tool_confirm", id));
    expect(text(again.post[0])).toContain("already handled");
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("cancels without running", async () => {
    const { router, call } = build([tool("jobs_run", { readOnly: false })], { jev: jevPicks("tool:jobs_run") });
    const [card] = await router.handle("kick off the nightly", context);
    const id = buttonValue(card, "devhub_tool_confirm");
    const cancelled = await router.interact(interaction("devhub_tool_cancel", id));
    expect(cancelled.update?.text).toContain("was not run");
    await router.interact(interaction("devhub_tool_confirm", id));
    expect(call).not.toHaveBeenCalled();
  });
  it("includes a tool's boolean confirmation gate in the exact request shown for approval", async () => {
    const gated = tool("jobs_run", { readOnly: false, properties: { id: { type: "string" }, confirm: { type: "boolean" } } });
    const { router, call } = build([gated], { jev: jevPicks("tool:jobs_run") });
    const [card] = await router.handle("kick off the nightly", context);
    expect(card.text).toContain("confirm: true");
    expect(call).not.toHaveBeenCalled();
    await router.interact(interaction("devhub_tool_confirm", buttonValue(card, "devhub_tool_confirm")));
    expect(call).toHaveBeenCalledExactlyOnceWith("work", "jobs_run", { confirm: true });
  });
  it("leaves provider-side approval as a separate step after the Slack confirmation", async () => {
    const proposal = tool("jira_ticket_transition", { readOnly: false, properties: { confirm: { type: "boolean" } } });
    const call = vi.fn(async () => ({ text: "Proposed, not applied. A person confirms in DevHub. Nothing has changed in Jira yet.", isError: false }));
    const { router } = build([proposal], { jev: jevPicks("tool:jira_ticket_transition"), call });
    const [card] = await router.handle("move my ticket", context);
    const confirmed = await router.interact(interaction("devhub_tool_confirm", buttonValue(card, "devhub_tool_confirm")));
    expect(confirmed.post[0].text).toContain("Proposed, not applied");
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("expires after ten minutes", async () => {
    let now = 1_000_000;
    const confirms = new ToolConfirmStore(root, () => now);
    const call = vi.fn(async () => ({ text: "{}", isError: false }));
    const router = new SlackToolRouter({ catalog: { tools: vi.fn(async () => [tool("jobs_run", { readOnly: false })]), call, close: vi.fn() }, jev: jevPicks("tool:jobs_run"), model: vi.fn(), confirms, record: () => {}, totals: slackUsageTotals as never });
    const [card] = await router.handle("kick off the nightly", context);
    now += 10 * 60 * 1000 + 1;
    const reply = await router.interact(interaction("devhub_tool_confirm", buttonValue(card, "devhub_tool_confirm")));
    expect(text(reply.post[0])).toContain("expired");
    expect(call).not.toHaveBeenCalled();
  });
  it("refuses a different user or channel", async () => {
    const { router, call } = build([tool("jobs_run", { readOnly: false })], { jev: jevPicks("tool:jobs_run") });
    const [card] = await router.handle("kick off the nightly", context);
    const id = buttonValue(card, "devhub_tool_confirm");
    await router.interact(interaction("devhub_tool_confirm", id, { userId: "UOTHER" }));
    await router.interact(interaction("devhub_tool_confirm", id, { channelId: "COTHER" }));
    expect(call).not.toHaveBeenCalled();
    await router.interact(interaction("devhub_tool_confirm", id));
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("won't let a 'did you mean' id be used as a confirmation", async () => {
    const { router, call } = build([tool("a_one", { readOnly: false }), tool("b_two", { readOnly: false })], { jev: jevPicks(["tool:a_one", 0.3]) });
    const [card] = await router.handle("hmm", context);
    await router.interact(interaction("devhub_tool_confirm", buttonValue(card, "devhub_tool_pick_1")));
    expect(call).not.toHaveBeenCalled();
  });
  it("sends a picked write tool to a confirm card, not straight to execution", async () => {
    const { router, call } = build([tool("a_one", { readOnly: false }), tool("b_two")], { jev: jevPicks(["tool:a_one", 0.3]) });
    const [card] = await router.handle("hmm", context);
    const reply = await router.interact(interaction("devhub_tool_pick_1", buttonValue(card, "devhub_tool_pick_1")));
    expect(text(reply.post[0])).toContain("Run a_one in work?");
    expect(call).not.toHaveBeenCalled();
  });
  it("lets Jev choose a write tool but still asks, even when its confidence is 1", async () => {
    const { router, call } = build([writer], { jev: jevPicks(["tool:notes_append", 1]) });
    const [card] = await router.handle("append hello to the note", context);
    expect(call).not.toHaveBeenCalled();
    expect(text(card)).toMatch(/^Run notes_append|path/);
  });
});

describe("cheap model use", () => {
  const filler = tool("notes_find", { required: ["topic"], properties: { topic: { type: "string" } } });
  it("fills arguments with the model, validated against the schema", async () => {
    const model = vi.fn(async (): Promise<CheapModelResult> => ({ ok: true, text: "```json\n{\"topic\":\"retries\"}\n```", label: "cheap" }));
    const { router, call } = build([filler], { jev: jevPicks("tool:notes_find"), model });
    await router.handle("find my retry thoughts", context);
    expect(call).toHaveBeenCalledWith("work", "notes_find", { topic: "retries" });
    expect(slackUsageTotals(root)).toMatchObject({ jevCalls: 1, modelCalls: 1 });
  });
  it("asks John when the model's arguments don't fit the schema, and runs nothing", async () => {
    const model = vi.fn(async (): Promise<CheapModelResult> => ({ ok: true, text: "{\"topic\": 42}", label: "cheap" }));
    const { router, call } = build([filler], { jev: jevPicks("tool:notes_find"), model });
    const [reply] = await router.handle("find my retry thoughts", context);
    expect(text(reply)).toContain("couldn't get valid details (topic)");
    expect(call).not.toHaveBeenCalled();
  });
  it("tells John a cheap model is needed when none is configured, and calls no model", async () => {
    const { router, call, model } = build([filler], { jev: jevPicks("tool:notes_find") });
    const [reply] = await router.handle("find my retry thoughts", context);
    expect(text(reply)).toContain("notes_find looks right");
    expect(text(reply)).toContain("topic");
    expect(text(reply)).toContain("model tiers");
    expect(model).toHaveBeenCalledTimes(1);
    expect(call).not.toHaveBeenCalled();
    expect(slackUsageTotals(root).modelCalls).toBe(0);
  });
  it("never calls the model when the rules already satisfy the schema", async () => {
    const { router, model } = build([tool("a_one")], { jev: jevPicks("tool:a_one") });
    await router.handle("do the a thing", context);
    expect(model).not.toHaveBeenCalled();
  });
  it("formats long results deterministically without paying for a summary or losing list links", async () => {
    const call = vi.fn(async () => ({ text: JSON.stringify({ rows: "x".repeat(3000) }), isError: false }));
    const model = vi.fn(async (): Promise<CheapModelResult> => ({ ok: true, text: "Three things happened.", label: "cheap" }));
    const { router } = build([tool("a_one")], { jev: jevPicks("tool:a_one"), model, call });
    const [reply] = await router.handle("do the a thing", context);
    expect(text(reply)).toContain("Rows:");
    expect(text(reply)).toContain("Showing a preview");
    expect(model).not.toHaveBeenCalled();
  });
  it("trims long results to Slack's limit when no model is available", async () => {
    const call = vi.fn(async () => ({ text: "y".repeat(9000), isError: false }));
    const { router } = build([tool("a_one")], { jev: jevPicks("tool:a_one"), call });
    const [reply] = await router.handle("do the a thing", context);
    expect(text(reply).length).toBeLessThanOrEqual(3000);
    expect(text(reply)).toContain("Showing a preview");
  });
  it("caps a multi-step plan at three read-only calls", async () => {
    const plan = JSON.stringify([1, 2, 3, 4].map((n) => ({ tool: `r_tool${n}`, args: {} })));
    const model = vi.fn(async (): Promise<CheapModelResult> => ({ ok: true, text: plan, label: "cheap" }));
    const tools = [1, 2, 3, 4].map((n) => tool(`r_tool${n}`));
    const { router, call } = build(tools, { jev: jevPicks("tool:r_tool1"), model });
    const replies = await router.handle("show tool one and then show tool two then show three then show four", context);
    expect(call).toHaveBeenCalledTimes(3);
    expect(replies).toHaveLength(3);
  });
  it("stops a multi-step plan at the first write and asks for a button", async () => {
    const plan = JSON.stringify([{ tool: "r_read", args: {} }, { tool: "w_write", args: {} }, { tool: "r_read", args: {} }]);
    const model = vi.fn(async (): Promise<CheapModelResult> => ({ ok: true, text: plan, label: "cheap" }));
    const { router, call } = build([tool("r_read"), tool("w_write", { readOnly: false })], { jev: jevPicks("tool:r_read"), model });
    const replies = await router.handle("read it and then write it", context);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("work", "r_read", {});
    expect(text(replies[1])).toContain("Run w_write in work?");
    expect(replies).toHaveLength(2);
  });
  it("falls back to a single step when no model can plan", async () => {
    const { router, call } = build([tool("r_read"), tool("r_other")], { jev: jevPicks("tool:r_read") });
    await router.handle("read it and then something else", context);
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe("ticket commands without a model", () => {
  const day = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
  const startAuto = tool("storyboard_start_auto", { readOnly: false, required: ["taskId", "taskDate"], properties: { taskId: { type: "string" }, taskDate: day } });
  const setStage = tool("tasks_set_stage", { readOnly: false, required: ["taskId", "date", "stage"], properties: { taskId: { type: "string" }, date: day, stage: { type: "string", enum: ["draft", "ready"] } } });
  const noteUpdate = tool("task_note_update", { readOnly: false, required: ["op"], properties: { op: { type: "string", enum: ["append_log", "set_status"] }, taskId: { type: "string" }, date: day, message: { type: "string" } } });
  const transition = tool("jira_ticket_transition", { readOnly: false, required: ["key"], properties: { key: { type: "string" }, transitionId: { type: "string" }, confirm: { type: "boolean" } } });
  const planAgent = tool("tasks_agent_plan", { readOnly: false, required: ["taskId", "date"], properties: { taskId: { type: "string" }, date: day } });
  const cardAction = tool("storyboard_card_action", { readOnly: false, required: ["action"], properties: { action: { type: "string", enum: ["answer", "retry", "auto-retry"] }, taskId: { type: "string" } } });
  const match = { taskId: "task-1", date: "2026-10-12", title: "Fix the ad slot", profile: "work", own: true };
  const one = vi.fn(async () => [match]);

  async function confirmAndRun(router: SlackToolRouter, reply: { blocks?: unknown[] }) {
    return router.interact(interaction("devhub_tool_confirm", buttonValue(reply, "devhub_tool_confirm")));
  }

  it.each([
    ["start PTF-1234 on auto", "storyboard_start_auto", { taskId: "task-1", taskDate: "2026-10-12" }],
    ["start PTF-1234 on plan", "tasks_agent_plan", { taskId: "task-1", date: "2026-10-12" }],
    ["plan PTF-1234", "tasks_agent_plan", { taskId: "task-1", date: "2026-10-12" }],
    ["mark PTF-1234 ready", "tasks_set_stage", { taskId: "task-1", date: "2026-10-12", stage: "ready" }],
    ["log PTF-1234: check the ad slot", "task_note_update", { op: "append_log", taskId: "task-1", date: "2026-10-12", message: "check the ad slot" }],
  ])("%s reaches a filled Confirm card at $0", async (message, name, args) => {
    const { router, call, jev, model } = build([startAuto, planAgent, setStage, noteUpdate, transition], { findTasks: one });
    const [reply] = await router.handle(message, context);
    expect(text(reply)).toContain(`Run ${name} in work?`);
    expect(call).not.toHaveBeenCalled();
    expect(jev).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    expect(one).toHaveBeenCalledWith({ jiraKey: "PTF-1234" }, "work");
    expect(slackUsageTotals(root)).toMatchObject({ queries: 1, jevCalls: 0, modelCalls: 0 });
    await confirmAndRun(router, reply);
    expect(call).toHaveBeenCalledWith("work", name, args);
  });

  it("says a plan is plan-only, and keeps auto for start", async () => {
    const { router } = build([startAuto, planAgent], { findTasks: one });
    const [plan] = await router.handle("start PTF-1234 on plan", context);
    expect(text(plan)).toContain("Plan only — stops after the plan.");
    expect(text(plan)).toContain("not a guaranteed write sandbox");
    expect(text(plan)).toContain("Run tasks_agent_plan in work?");
    expect(JSON.stringify(plan.blocks)).not.toContain("\"danger\"");
    const [auto] = await router.handle("start PTF-1234 on auto", context);
    expect(text(auto)).toContain("Run storyboard_start_auto in work?");
  });

  it("runs on the profile the task lives in", async () => {
    const { router, call } = build([startAuto], { findTasks: vi.fn(async () => [{ ...match, profile: "personal" }]) });
    const [reply] = await router.handle("start PTF-1234", context);
    expect(text(reply)).toContain("in personal?");
    await confirmAndRun(router, reply);
    expect(call).toHaveBeenCalledWith("personal", "storyboard_start_auto", { taskId: "task-1", taskDate: "2026-10-12" });
  });

  it("asks with one button per task when several share the ticket, and a button only picks: the run waits for Confirm", async () => {
    const two = vi.fn(async () => [{ ...match, own: false }, { ...match, taskId: "task-2", title: "Ad slot QA", own: false }]);
    const { router, call, model } = build([startAuto], { findTasks: two });
    const [reply] = await router.handle("start PTF-1234 on auto", context);
    expect(text(reply)).toContain("Which task?");
    expect(text(reply)).toContain("Ad slot QA · 2026-10-12");
    expect(model).not.toHaveBeenCalled();
    const picked = await router.interact(interaction("devhub_tool_pick_2", buttonValue(reply, "devhub_tool_pick_2")));
    expect(call).not.toHaveBeenCalled();
    expect(text(picked.post[0])).toContain("Run storyboard_start_auto in work?");
    expect(text(picked.post[0])).toContain("taskId: task-2");
    const confirmed = await confirmAndRun(router, picked.post[0]);
    expect(call).toHaveBeenCalledWith("work", "storyboard_start_auto", { taskId: "task-2", taskDate: "2026-10-12" });
    expect(confirmed.update?.text).toContain("Confirmed");
  });

  it("answers plainly when no task has the ticket, without a model", async () => {
    const { router, model } = build([startAuto], { findTasks: vi.fn(async () => []) });
    const [reply] = await router.handle("start PTF-9 on auto", context);
    expect(text(reply)).toContain("No DevHub task is linked to PTF-9");
    expect(model).not.toHaveBeenCalled();
  });

  it("moves a Jira ticket by transition name: lists, then confirms the matching id", async () => {
    const call = vi.fn(async (_profile: string, name: string, args: Record<string, unknown>) => ({
      text: args.transitionId ? `Moved via ${String(args.transitionId)}` : "Available transitions for PTF-1234:\n- 11: To Do\n- 31: Code Review\n\nApply with jira_ticket_transition(key, transitionId, confirm: true).", isError: false,
    }));
    const { router, jev } = build([transition], { call });
    const [reply] = await router.handle("move PTF-1234 to code review", context);
    expect(call).toHaveBeenCalledWith("work", "jira_ticket_transition", { key: "PTF-1234" });
    expect(text(reply)).toContain("transitionId: 31");
    expect(jev).not.toHaveBeenCalled();
    await confirmAndRun(router, reply);
    expect(call).toHaveBeenLastCalledWith("work", "jira_ticket_transition", { key: "PTF-1234", transitionId: "31", confirm: true });
  });

  it("offers the transitions as buttons when none matches the name", async () => {
    const call = vi.fn(async () => ({ text: "Available transitions for PTF-1234:\n- 11: To Do\n- 31: Code Review", isError: false }));
    const { router } = build([transition], { call });
    const [reply] = await router.handle("move PTF-1234 to shipped", context);
    expect(text(reply)).toContain("Move PTF-1234 to…");
    const picked = await router.interact(interaction("devhub_tool_pick_2", buttonValue(reply, "devhub_tool_pick_2")));
    expect(call).toHaveBeenCalledTimes(1);
    expect(text(picked.post[0])).toContain("Run jira_ticket_transition in work?");
    expect(text(picked.post[0])).toContain("transitionId: 31");
    await confirmAndRun(router, picked.post[0]);
    expect(call).toHaveBeenLastCalledWith("work", "jira_ticket_transition", { key: "PTF-1234", transitionId: "31", confirm: true });
  });

  it("fills a Jev-picked tool's task and enum from the message", async () => {
    const { router, call, model } = build([cardAction, tool("notes_list")], { findTasks: one, jev: jevPicks("tool:storyboard_card_action") });
    const [reply] = await router.handle("retry PTF-1234 please", context);
    expect(model).not.toHaveBeenCalled();
    await confirmAndRun(router, reply);
    expect(call).toHaveBeenCalledWith("work", "storyboard_card_action", { action: "retry", taskId: "task-1" });
  });
});

describe("choice buttons never run anything", () => {
  const deleteTask = tool("tasks_delete", { readOnly: false, destructive: true, required: ["taskId"], properties: { taskId: { type: "string" } } });
  const two = vi.fn(async () => [
    { taskId: "task-1", date: "2026-10-12", title: "Fix the ad slot", profile: "work" },
    { taskId: "task-2", date: "2026-10-13", title: "Ad slot QA", profile: "work" },
  ]);
  const dangerStyle = (message: { blocks?: unknown[] }) => (message.blocks as Array<{ type: string; elements?: Array<{ style?: string }> }>).find((block) => block.type === "actions")!.elements![0].style;

  it("a destructive tool's task choice leads to the red Confirm card, with the warning on the choice card too", async () => {
    const { router, call } = build([deleteTask], { findTasks: two, jev: jevPicks(["tool:tasks_delete", 1]) });
    const [choice] = await router.handle("delete PTF-1234", context);
    expect(text(choice)).toContain("Which task?");
    expect(text(choice)).toContain("This can't be undone.");
    expect(JSON.stringify(choice.blocks)).toContain("devhub_tool_pick_1");
    expect(JSON.stringify(choice.blocks)).not.toContain("devhub_tool_choose");
    const picked = await router.interact(interaction("devhub_tool_pick_2", buttonValue(choice, "devhub_tool_pick_2")));
    expect(call).not.toHaveBeenCalled();
    expect(text(picked.post[0])).toContain("Run tasks_delete in work?");
    expect(text(picked.post[0])).toContain("taskId: task-2");
    expect(text(picked.post[0])).toContain("This can't be undone.");
    expect(dangerStyle(picked.post[0])).toBe("danger");
    await router.interact(interaction("devhub_tool_confirm", buttonValue(picked.post[0], "devhub_tool_confirm")));
    expect(call).toHaveBeenCalledExactlyOnceWith("work", "tasks_delete", { taskId: "task-2" });
  });
  it("a plain write's task choice leads to a normal Confirm card", async () => {
    const write = tool("tasks_update", { readOnly: false, required: ["taskId"], properties: { taskId: { type: "string" } } });
    const { router, call } = build([write], { findTasks: two, jev: jevPicks(["tool:tasks_update", 1]) });
    const [choice] = await router.handle("update PTF-1234", context);
    expect(text(choice)).not.toContain("can't be undone");
    const picked = await router.interact(interaction("devhub_tool_pick_1", buttonValue(choice, "devhub_tool_pick_1")));
    expect(call).not.toHaveBeenCalled();
    expect(dangerStyle(picked.post[0])).toBe("primary");
  });
  it("a read-only tool's task choice may run straight away", async () => {
    const read = tool("tasks_plan_status", { required: ["taskId"], properties: { taskId: { type: "string" } } });
    const { router, call } = build([read], { findTasks: two, jev: jevPicks(["tool:tasks_plan_status", 1]) });
    const [choice] = await router.handle("plan status for PTF-1234", context);
    await router.interact(interaction("devhub_tool_pick_1", buttonValue(choice, "devhub_tool_pick_1")));
    expect(call).toHaveBeenCalledExactlyOnceWith("work", "tasks_plan_status", { taskId: "task-1" });
  });
  it("ignores a retired direct-run button, even with a live id", async () => {
    const { router, call } = build([deleteTask], { findTasks: two, jev: jevPicks(["tool:tasks_delete", 1]) });
    const [choice] = await router.handle("delete PTF-1234", context);
    const id = buttonValue(choice, "devhub_tool_pick_1");
    const reply = await router.interact(interaction("devhub_tool_choose_1", id));
    expect(text(reply.post[0])).toContain("can't find that request");
    expect(call).not.toHaveBeenCalled();
    expect(text((await router.interact(interaction("devhub_tool_pick_1", id))).post[0])).toContain("Run tasks_delete");
  });
});

describe("Slack-side risk ratings reach the Confirm card", () => {
  it.each([undefined, false, true])("always confirms repo_learn from Slack, including absent/stale caches: refresh=%s", async (refresh) => {
    const learn = tool("repo_learn", { required: ["name"], properties: { name: { type: "string" }, refresh: { type: "boolean" } } });
    const model = vi.fn(async (): Promise<CheapModelResult> => ({ ok: true, text: JSON.stringify({ name: "devhub", ...(refresh === undefined ? {} : { refresh }) }), label: "cheap" }));
    const { router, call } = build([learn], { jev: jevPicks(["tool:repo_learn", 1]), model });
    const [card] = await router.handle("explain the repo architecture", context);
    expect(text(card)).toContain("Run repo_learn in work?"); expect(call).not.toHaveBeenCalled();
  });
  it("makes datadog_investigate (annotated read-only) ask first, and never starts it from a keyword rule", async () => {
    const investigate = tool("datadog_investigate", { properties: { title: { type: "string" } } });
    const { router, call } = build([investigate], { jev: jevPicks(["tool:datadog_investigate", 1]) });
    const [card] = await router.handle("investigate the checkout 5xx alert", context);
    expect(text(card)).toContain("Run datadog_investigate in work?");
    expect(call).not.toHaveBeenCalled();
    await router.interact(interaction("devhub_tool_confirm", buttonValue(card, "devhub_tool_confirm")));
    expect(call).toHaveBeenCalledTimes(1);
  });
  it.each(["scripts_run", "agent_dispatch", "jobs_create", "jobs_update", "db_execute"])("%s gets the red button even though its annotation says non-destructive", async (name) => {
    const { router, call } = build([tool(name, { readOnly: false, destructive: false })], { jev: jevPicks([`tool:${name}`, 1]) });
    const [card] = await router.handle("do the thing", context);
    expect(text(card)).toContain("This can't be undone.");
    expect(JSON.stringify(card.blocks)).toContain("\"danger\"");
    expect(call).not.toHaveBeenCalled();
  });
  it("rates a multi-action tool by the action: worktrees list runs, remove is red", async () => {
    const worktrees = tool("repos_git_worktrees", { readOnly: false, destructive: false, required: ["name"], properties: { name: { type: "string" }, action: { type: "string", enum: ["list", "remove"] }, path: { type: "string" } } });
    const model = vi.fn(async (): Promise<CheapModelResult> => ({ ok: true, text: JSON.stringify({ name: "devhub", action: "remove", path: "/wt/old" }), label: "cheap" }));
    const listing = build([worktrees], { jev: jevPicks(["tool:repos_git_worktrees", 1]), model: vi.fn(async (): Promise<CheapModelResult> => ({ ok: true, text: JSON.stringify({ name: "devhub" }), label: "cheap" })) });
    const [list] = await listing.router.handle("worktrees for devhub", context);
    expect(listing.call).toHaveBeenCalledWith("work", "repos_git_worktrees", { name: "devhub" });
    expect(text(list)).not.toContain("Confirm");
    const removing = build([worktrees], { jev: jevPicks(["tool:repos_git_worktrees", 1]), model });
    const [card] = await removing.router.handle("remove the old devhub worktree", context);
    expect(removing.call).not.toHaveBeenCalled();
    expect(text(card)).toContain("This can't be undone.");
  });
});

describe("keyword rules don't shadow commands", () => {
  const noteUpdate = tool("task_note_update", { readOnly: false, required: ["op"], properties: { op: { type: "string", enum: ["append_log"] }, taskId: { type: "string" }, date: { type: "string" }, message: { type: "string" } } });
  const task = { taskId: "task-1", date: "2026-10-12", title: "Fix", profile: "work", own: true };
  it.each([
    ["log PTF-1: prepped for the meeting", "prepped for the meeting"],
    ["log PTF-1: cost was high", "cost was high"],
    ["log PTF-1: usage doubled after the deploy", "usage doubled after the deploy"],
  ])("%j is a note command, not the calendar or the usage card", async (message, logged) => {
    const { router, call, jev, model } = build([noteUpdate, tool("calendar_list"), tool("calendar_week")], { findTasks: vi.fn(async () => [task]) });
    const [card] = await router.handle(message, context);
    expect(text(card)).toContain("Run task_note_update in work?");
    expect(text(card)).toContain(`message: ${logged}`);
    expect(call).not.toHaveBeenCalled();
    expect(jev).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
  });
  it("still answers a bare 'cost' or 'meetings today' for free", async () => {
    const loadCalendar = vi.fn(async () => ({ state: "ok" as const, events: [] }));
    const { router, call, jev } = build([tool("calendar_list")], { loadCalendar, now: Date.parse("2026-10-18T09:00:00Z") });
    expect(text((await router.handle("what did slack cost", context))[0])).toContain("question");
    const [card] = await router.handle("meetings today", context);
    expect(loadCalendar).toHaveBeenCalledTimes(1);
    expect(text(card)).toContain("Calendar · Today");
    expect(call).not.toHaveBeenCalled();
    expect(jev).not.toHaveBeenCalled();
  });
});

describe("big confirmations", () => {
  const docsWrite = tool("docs_write", { readOnly: false, required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } });
  const pickDocs = (content: unknown) => ({ model: vi.fn(async (): Promise<CheapModelResult> => ({ ok: true, text: JSON.stringify({ path: "runbook.md", content }), label: "cheap" })) });
  it("shows a long value in full and still offers Confirm", async () => {
    const body = Array.from({ length: 300 }, (_, i) => `step ${i}`).join("\n");
    const { router, call } = build([docsWrite], { jev: jevPicks(["tool:docs_write", 1]), ...pickDocs(body) });
    const [card] = await router.handle("write the runbook", context);
    const shown = (card.blocks as Array<{ type: string; text?: { text: string } }>).filter((block) => block.type === "section").map((block) => block.text!.text).join("\n");
    expect(shown).toContain("step 0");
    expect(shown).toContain("step 299");
    expect(JSON.stringify(card.blocks)).toContain("devhub_tool_confirm");
    await router.interact(interaction("devhub_tool_confirm", buttonValue(card, "devhub_tool_confirm")));
    expect(call).toHaveBeenCalledWith("work", "docs_write", { path: "runbook.md", content: body });
  });
  it("offers no Confirm, and stores nothing to confirm, when it can't all be shown", async () => {
    const { router, call, confirms } = build([docsWrite], { jev: jevPicks(["tool:docs_write", 1]), ...pickDocs("z".repeat(20_000)) });
    const [card] = await router.handle("write the runbook", context);
    expect(text(card)).toContain("Too large to approve from Slack — open in DevHub");
    expect(JSON.stringify(card.blocks)).toContain("devhub_open");
    expect(JSON.stringify(card.blocks)).not.toContain("devhub_tool_confirm");
    expect(call).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, "tool-confirm.json"))).toBe(false);
    void confirms;
  });
});

describe("cost leaks", () => {
  it.each(["thanks", "ok", "Thank you!", "cheers", "👍"])("%j costs no Jev or model call and gets no reply", async (message) => {
    const { router, jev, model, call } = build([tool("a_one")], { jev: jevPicks("tool:a_one") });
    expect(await router.handle(message, context)).toEqual([]);
    expect(jev).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    expect(slackUsageTotals(root)).toMatchObject({ queries: 1, jevCalls: 0, modelCalls: 0 });
  });
  it.each(["what happened then?", "then what", "and then", "show me the prs, then something else", "read it and then maybe"])("%j doesn't trigger a plan call", async (message) => {
    const { router, model } = build([tool("r_read"), tool("r_other")], { jev: jevPicks("tool:r_read") });
    await router.handle(message, context);
    expect(model).not.toHaveBeenCalled();
  });
  it("plans only when two steps both name something to do", async () => {
    const plan = JSON.stringify([{ tool: "r_read", args: {} }, { tool: "r_other", args: {} }]);
    const model = vi.fn(async (): Promise<CheapModelResult> => ({ ok: true, text: plan, label: "cheap" }));
    const { router, call } = build([tool("r_read"), tool("r_other")], { jev: jevPicks("tool:r_read"), model });
    await router.handle("list the prs, then check the jobs", context);
    expect(model).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("uses the schema's default for a required detail instead of asking the model", async () => {
    const recent = tool("db_history", { required: ["limit"], properties: { limit: { type: "integer", default: 20 } } });
    const { router, call, model } = build([recent], { jev: jevPicks("tool:db_history") });
    await router.handle("show my recent db history", context);
    expect(call).toHaveBeenCalledExactlyOnceWith("work", "db_history", { limit: 20 });
    expect(model).not.toHaveBeenCalled();
  });
});

describe("a click that doesn't fit isn't consumed", () => {
  it("a Did-you-mean id sent as Confirm, and a confirm id sent as a pick, keep their entries alive", async () => {
    const { router, call } = build([tool("a_one", { readOnly: false }), tool("b_two", { readOnly: false })], { jev: jevPicks(["tool:a_one", 0.3]) });
    const [pickCard] = await router.handle("hmm", context);
    const pickId = buttonValue(pickCard, "devhub_tool_pick_1");
    await router.interact(interaction("devhub_tool_confirm", pickId));
    const picked = await router.interact(interaction("devhub_tool_pick_1", pickId));
    expect(text(picked.post[0])).toContain("Run a_one in work?");
    const confirmId = buttonValue(picked.post[0], "devhub_tool_confirm");
    const early = await router.interact(interaction("devhub_tool_pick_1", confirmId));
    expect(text(early.post[0])).toContain("can't find that request");
    expect(call).not.toHaveBeenCalled();
    await router.interact(interaction("devhub_tool_confirm", confirmId));
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("a click from the wrong user or channel doesn't consume it either", async () => {
    const { router, call } = build([tool("jobs_run", { readOnly: false })], { jev: jevPicks("tool:jobs_run") });
    const [card] = await router.handle("kick off the nightly", context);
    const id = buttonValue(card, "devhub_tool_confirm");
    await router.interact(interaction("devhub_tool_confirm", id, { userId: "UOTHER" }));
    await router.interact(interaction("devhub_tool_cancel", id, { channelId: "COTHER" }));
    await router.interact(interaction("devhub_tool_confirm", id));
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe("done, reopen and add task: one click, with Undo", () => {
  const day = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
  const reopen = tool("task_reopen", { readOnly: false, required: ["id"], properties: { id: { type: "string", description: "Task ID or linked Jira ticket key" }, date: day, reason: { type: "string" }, addressFeedback: { type: "boolean" } } });
  const update = tool("tasks_update", { readOnly: false, required: ["id"], properties: { id: { type: "string", description: "Task ID (UUID)" }, date: day, status: { type: "string", enum: ["complete", "abandon", "reactivate"] }, due: { type: ["string", "null"] } } });
  const capture = tool("tasks_capture", { readOnly: false, required: ["text"], properties: { text: { type: "string", maxLength: 500 }, date: day } });
  const remove = tool("tasks_delete", { readOnly: false, destructive: true, required: ["id"], properties: { id: { type: "string" }, date: day } });
  const open = { taskId: "task-1", date: "2026-10-12", title: "Fix the ad slot", profile: "work", own: true };
  const closed = { ...open, done: true };
  const respond = () => vi.fn(async (_profile: string, name: string, args: Record<string, unknown>) => {
    if (name === "tasks_update" || name === "task_reopen") return { text: `Updated task: ${args.id} — Fix the ad slot (done=${args.status === "complete"}, stage=ready)`, isError: false };
    if (name === "tasks_capture") return { text: `Captured draft new-1 on 2026-10-18: ${args.text}\nNote: task-notes/2026-10-18-new-1\nContext: 0 note(s), 0 PR(s), 0 earlier task(s), 0 alert(s).`, isError: false };
    if (name === "tasks_delete") return { text: `Deleted task: ${args.id}`, isError: false };
    return { text: "{}", isError: false };
  });
  const tools = [update, reopen, capture, remove];

  it("done KEY checks the task off at once, with no Jev, model or Confirm, and the card has Undo and Open", async () => {
    const call = respond();
    const { router, jev, model } = build(tools, { call, findTasks: async () => [open] });
    const [card] = await router.handle("done PTF-1234", context);
    expect(call).toHaveBeenCalledExactlyOnceWith("work", "tasks_update", { id: "task-1", date: "2026-10-12", status: "complete" });
    expect(text(card)).toContain("✅ Done · Fix the ad slot");
    expect(JSON.stringify(card.blocks)).toContain("devhub_tool_undo");
    expect(JSON.stringify(card.blocks)).toContain("http://localhost:1337/storyboard?task=task-1&profile=work");
    expect(JSON.stringify(card.blocks)).not.toContain("devhub_tool_confirm");
    expect(jev).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    expect(slackUsageTotals(root)).toMatchObject({ queries: 1, rules: 1, jevCalls: 0, modelCalls: 0 });
  });

  it("Undo reverses it with the stored call, exactly once", async () => {
    const call = respond();
    const { router } = build(tools, { call, findTasks: async () => [open] });
    const [card] = await router.handle("done PTF-1234", context);
    const undo = await router.interact(interaction("devhub_tool_undo", buttonValue(card, "devhub_tool_undo")));
    expect(call).toHaveBeenLastCalledWith("work", "tasks_update", { id: "task-1", date: "2026-10-12", status: "reactivate" });
    expect(undo.update?.text).toBe("↩️ Undone — Fix the ad slot");
    const again = await router.interact(interaction("devhub_tool_undo", buttonValue(card, "devhub_tool_undo")));
    expect(text(again.post[0])).toContain("already handled");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("reopen KEY puts a closed task back, and its Undo checks it off again", async () => {
    const call = respond();
    const { router } = build(tools, { call, findTasks: async () => [closed] });
    const [card] = await router.handle("reopen PTF-1234", context);
    expect(call).toHaveBeenCalledWith("work", "task_reopen", { id: "task-1", date: "2026-10-12" });
    expect(text(card)).toContain("↩️ Task reopened · Fix the ad slot");
    await router.interact(interaction("devhub_tool_undo", buttonValue(card, "devhub_tool_undo")));
    expect(call).toHaveBeenLastCalledWith("work", "tasks_update", { id: "task-1", date: "2026-10-12", status: "complete" });
  });

  it("reopen and address feedback is free routing but confirms before starting an agent", async () => {
    const call = respond();
    const { router, jev, model } = build(tools, { call, findTasks: async () => [closed] });
    const [card] = await router.handle("reopen PTF-1234 and address feedback", context);
    expect(JSON.stringify(card.blocks)).toContain("devhub_tool_confirm");
    expect(call).not.toHaveBeenCalled();
    expect(jev).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    await router.interact(interaction("devhub_tool_confirm", buttonValue(card, "devhub_tool_confirm")));
    expect(call).toHaveBeenCalledWith("work", "task_reopen", { id: "task-1", date: "2026-10-12", addressFeedback: true });
  });

  it("finds a task by words from its title", async () => {
    const call = respond();
    const findTasks = vi.fn(async () => [open]);
    const { router } = build(tools, { call, findTasks });
    await router.handle("done ad slot", context);
    expect(findTasks).toHaveBeenCalledWith({ words: "ad slot" }, "work");
    expect(call).toHaveBeenCalledWith("work", "tasks_update", expect.objectContaining({ id: "task-1" }));
  });

  it("runs on the profile the task lives in", async () => {
    const call = respond();
    const { router } = build(tools, { call, findTasks: async () => [{ ...open, profile: "personal" }] });
    await router.handle("done PTF-1234", context);
    expect(call).toHaveBeenCalledWith("personal", "tasks_update", expect.anything());
  });

  it("several open tasks become the Which task? buttons, and a button only picks: the change still waits for Confirm", async () => {
    const call = respond();
    const second = { ...open, taskId: "task-2", title: "Fix the ad slot (copy)" };
    const { router } = build(tools, { call, findTasks: async () => [open, second] });
    const [choices] = await router.handle("done fix the ad slot", context);
    expect(text(choices)).toContain("Which task?");
    expect(call).not.toHaveBeenCalled();
    const picked = await router.interact(interaction("devhub_tool_pick_2", buttonValue(choices, "devhub_tool_pick_2")));
    expect(text(picked.post[0])).toContain("Run tasks_update in work?");
    expect(call).not.toHaveBeenCalled();
    await router.interact(interaction("devhub_tool_confirm", buttonValue(picked.post[0], "devhub_tool_confirm")));
    expect(call).toHaveBeenCalledExactlyOnceWith("work", "tasks_update", { id: "task-2", date: "2026-10-12", status: "complete" });
  });

  it("says so, and calls nothing, when the task is already in that state", async () => {
    const call = respond();
    expect(text((await build(tools, { call, findTasks: async () => [closed] }).router.handle("done PTF-1234", context))[0])).toContain("already done");
    expect(text((await build(tools, { call, findTasks: async () => [open] }).router.handle("reopen PTF-1234", context))[0])).toContain("already open");
    expect(call).not.toHaveBeenCalled();
  });

  it("won't check off a task whose agent is still working", async () => {
    const call = respond();
    const { router } = build(tools, { call, findTasks: async () => [{ ...open, running: true }] });
    expect(text((await router.handle("done PTF-1234", context))[0])).toContain("still has work running");
    expect(call).not.toHaveBeenCalled();
  });

  it("says plainly when a ticket key has no task, but lets unmatched words fall through to the normal router", async () => {
    const call = respond();
    const { router, jev } = build(tools, { call, findTasks: async () => [], jev: jevPicks("special:unsupported") });
    expect(text((await router.handle("done PTF-9", context))[0])).toContain("No DevHub task is linked to PTF-9");
    expect(jev).not.toHaveBeenCalled();
    await router.handle("complete the quarterly planning deck", context);
    expect(jev).toHaveBeenCalledTimes(1);
    expect(call).not.toHaveBeenCalled();
  });

  it("reports a failed update honestly and leaves no Undo behind", async () => {
    const call = vi.fn(async () => ({ text: "Task not found: task-1", isError: false }));
    const { router, confirms } = build(tools, { call, findTasks: async () => [open] });
    const [reply] = await router.handle("done PTF-1234", context);
    expect(text(reply)).toContain("Nothing was changed");
    expect(JSON.stringify(reply.blocks)).not.toContain("devhub_tool_undo");
    expect(JSON.stringify((confirms as unknown as { read: () => unknown }).read?.() ?? {})).not.toContain("undo");
  });

  it("add task saves a draft through the capture tool, never starts anything, and Undo deletes it", async () => {
    const call = respond();
    const { router, jev, model } = build([...tools, tool("agent_dispatch", { readOnly: false }), tool("storyboard_start_auto", { readOnly: false })], { call });
    const [card] = await router.handle("add task Renew the cert for PTF-77 https://example.com/cert #ops", context);
    expect(call).toHaveBeenCalledExactlyOnceWith("work", "tasks_capture", { text: "Renew the cert for PTF-77 https://example.com/cert #ops" });
    expect(text(card)).toContain("➕ Saved to To do · Renew the cert for PTF-77");
    expect(JSON.stringify(card.blocks)).toContain("No agent started");
    expect(JSON.stringify(card.blocks)).toContain("http://localhost:1337/storyboard?task=new-1&profile=work");
    expect(jev).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    const undo = await router.interact(interaction("devhub_tool_undo", buttonValue(card, "devhub_tool_undo")));
    expect(call).toHaveBeenLastCalledWith("work", "tasks_delete", { id: "new-1", date: "2026-10-18" });
    expect(undo.update?.text).toContain("Undone");
    expect(call.mock.calls.map(([, name]) => name)).toEqual(["tasks_capture", "tasks_delete"]);
  });

  it.each(["todo: ship it", "task: write the postmortem", "todo call Sam"])("%j is captured the same way", async (message) => {
    const call = respond();
    await build(tools, { call }).router.handle(message, context);
    expect(call).toHaveBeenCalledWith("work", "tasks_capture", { text: message.replace(/^(?:todo:?|task:)\s*/, "") });
  });

  it("offers no Undo when the delete tool isn't there, and says nothing was saved when capture fails", async () => {
    const [card] = await build([capture], { call: respond() }).router.handle("add task x1", context);
    expect(JSON.stringify(card.blocks)).not.toContain("devhub_tool_undo");
    const failing = vi.fn(async () => ({ text: "boom", isError: true }));
    expect(text((await build(tools, { call: failing }).router.handle("add task x1", context))[0])).toContain("Nothing was saved");
  });

  it("an Undo entry only runs the task tools it was made for, and only as an Undo", async () => {
    const call = respond();
    const { router, confirms } = build([...tools, tool("scripts_run", { readOnly: false })], { call });
    const id = await confirms.create({ kind: "undo", tool: "scripts_run", args: {}, label: "x", profile: "work", teamId: "TTEAM", userId: "UOWNER", channel: "CCHANNEL" });
    const refused = await router.interact(interaction("devhub_tool_undo", id));
    expect(refused.update?.text).toBe("That undo isn't available.");
    const [card] = await build(tools, { call, findTasks: async () => [open] }).router.handle("done PTF-1", context);
    const undoId = buttonValue(card, "devhub_tool_undo");
    const asConfirm = await router.interact(interaction("devhub_tool_confirm", undoId));
    expect(text(asConfirm.post[0])).toContain("can't find that request");
    expect(call).not.toHaveBeenCalledWith("work", "scripts_run", expect.anything());
  });
});

describe("the PR card", () => {
  const row = (n: number, patch: Record<string, unknown> = {}) => ({ number: n, title: `PR ${n}`, url: `https://github.com/acme/app/pull/${n}`, repo: "acme/app", createdAt: "2026-10-15T09:00:00Z", checks: "passing", author: { login: "sam" }, ...patch });
  const data = (patch: Record<string, unknown> = {}) => ({ configured: true, authored: [], reviews: [], owned: [], ownedFailed: [], stale: false, ...patch }) as never;
  const now = Date.parse("2026-10-18T09:00:00Z");

  it.each(["prs", "my prs", "owned prs", "review requests"])("%j shows one card and costs nothing", async (message) => {
    const loadPrs = vi.fn(async () => data({ authored: [row(1)] }));
    const { router, call, jev, model } = build([tool("prs_list")], { loadPrs, now });
    const [card] = await router.handle(message, context);
    expect(text(card)).toContain("Pull requests · 1");
    expect(loadPrs).toHaveBeenCalledTimes(1);
    expect(call).not.toHaveBeenCalled();
    expect(jev).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    expect(slackUsageTotals(root)).toMatchObject({ queries: 1, rules: 1, jevCalls: 0, modelCalls: 0 });
  });

  it("puts failing CI first in each section and caps each at five with a Show more that posts the rest in the thread", async () => {
    const authored = [...Array.from({ length: 6 }, (_, i) => row(i + 1)), row(7, { checks: "failing" })];
    const { router } = build([], { loadPrs: async () => data({ authored }), now });
    const [card] = await router.handle("prs", context);
    const body = JSON.stringify(card.blocks);
    expect(body.indexOf("PR 7")).toBeLessThan(body.indexOf("PR 1"));
    expect(body).toContain("🔴");
    expect(body).not.toContain("PR 6");
    expect(body).toContain("+2 more");
    const more = await router.interact(interaction("devhub_tool_view", buttonValue(card, "devhub_tool_view")));
    expect(more.post).toHaveLength(1);
    expect(text(more.post[0])).toContain("PR 6");
    expect(more.post[0].thread_ts).toBe("1.1");
    const again = await router.interact(interaction("devhub_tool_view", buttonValue(card, "devhub_tool_view")));
    expect(text(again.post[0])).toContain("already handled");
  });

  it("splits mine, review requested and owned without repeating a PR, and shows the author only on the others", async () => {
    const mine = row(1, { author: { login: "me" } });
    const { router } = build([], { loadPrs: async () => data({ authored: [mine], reviews: [mine, row(2, { author: { login: "kim" } })], owned: [mine, row(2), row(3, { author: { login: "lee" } })] }), now });
    const [card] = await router.handle("prs", context);
    const body = JSON.stringify(card.blocks);
    expect(body).toContain("Mine · 1");
    expect(body).toContain("Review requested · 1");
    expect(body).toContain("Owned repos · 1");
    expect(body).toContain("by kim");
    expect(body).toContain("by lee");
    expect(body).not.toContain("by me");
    expect(body).toContain("3d");
  });

  it("says GitHub isn't signed in, or couldn't be reached, instead of an empty list", async () => {
    expect(text((await build([], { loadPrs: async () => data({ configured: false }) }).router.handle("prs", context))[0])).toContain("gh auth login");
    expect(text((await build([], { loadPrs: async () => { throw new Error("rate limited"); } }).router.handle("prs", context))[0])).toContain("Couldn't load your PRs");
    expect(text((await build([]).router.handle("prs", context))[0])).toContain("isn't available");
  });

  it("never turns an unreadable Owned list into a zero", async () => {
    const [unreadable] = await build([], { loadPrs: async () => data({ owned: undefined }) }).router.handle("prs", context);
    expect(JSON.stringify(unreadable.blocks)).toContain("Owned repos · unavailable");
    const [partial] = await build([], { loadPrs: async () => data({ owned: [row(9)], ownedFailed: ["acme/other"] }), now }).router.handle("prs", context);
    expect(JSON.stringify(partial.blocks)).toContain("Owned repos · 1+");
  });
});

describe("meetings", () => {
  const event = (title: string, start: string, end: string, patch: Record<string, unknown> = {}) => ({ id: title, title, start, end, isAllDay: false, ...patch });
  const events = [
    event("Standup", "2026-10-18T08:30:00Z", "2026-10-18T08:45:00Z", { conferenceUrl: "https://meet.google.com/abc", htmlLink: "https://calendar.google.com/e/1" }),
    event("Retro", "2026-10-19T13:00:00Z", "2026-10-19T14:00:00Z"),
  ];
  const now = Date.parse("2026-10-18T07:00:00Z");
  const loadCalendar = async () => ({ state: "ok" as const, events });

  it("meetings tomorrow lists that day in London time, free", async () => {
    vi.stubEnv("DEVHUB_TIMEZONE", "Europe/London");
    const { router, call, jev } = build([], { loadCalendar, now });
    const [card] = await router.handle("meetings tomorrow", context);
    expect(text(card)).toContain("Retro");
    expect(text(card)).toContain("14:00–15:00");
    expect(text(card)).not.toContain("Standup");
    expect(call).not.toHaveBeenCalled();
    expect(jev).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("next meeting shows how long is left, with a Join button as its one action", async () => {
    const [card] = await build([], { loadCalendar, now }).router.handle("next meeting", context);
    expect(text(card)).toContain("Standup");
    expect(text(card)).toContain("in 1h 30m");
    const body = JSON.stringify(card.blocks);
    expect(body).toContain("https://meet.google.com/abc");
    expect(body.match(/"type":"button"/g)).toHaveLength(1);
  });

  it("says when the calendar isn't connected, or can't be read", async () => {
    expect(text((await build([], { loadCalendar: async () => ({ state: "not-configured" as const }) }).router.handle("calendar", context))[0])).toContain("isn't connected");
    expect(text((await build([], { loadCalendar: async () => { throw new Error("x"); } }).router.handle("calendar", context))[0])).toContain("Couldn't load your calendar");
  });

  it("still sends the week view to the calendar_week tool", async () => {
    const { router, call } = build([tool("calendar_week")], { loadCalendar });
    await router.handle("meetings this week", context);
    expect(call).toHaveBeenCalledWith("work", "calendar_week", {});
  });

  it("my tickets runs jira_tickets for free", async () => {
    const { router, call, jev } = build([tool("jira_tickets")]);
    const [card] = await router.handle("my tickets", context);
    expect(call).toHaveBeenCalledExactlyOnceWith("work", "jira_tickets", {});
    expect(text(card)).toContain("Jira tickets");
    expect(jev).not.toHaveBeenCalled();
  });
});

describe("worktrees: list, preview, then one red Confirm", () => {
  const cleanup = tool("repos_worktree_cleanup", { readOnly: false, destructive: true, properties: { action: { type: "string", enum: ["list", "remove"] }, items: { type: "array", items: { type: "object" } }, dryRun: { type: "boolean" }, confirm: { type: "boolean" } } });
  const rows = [
    { repo: "app", path: "/wt/app-merged", branch: "feat/a", reason: "pr-merged", pr: { number: 12 } },
    { repo: "app", path: "/wt/app-dirty", branch: "feat/b", reason: "pr-merged", pr: { number: 13 } },
    { repo: "api", path: "/wt/api-run", branch: "devhub/agent/x", reason: "run-finished" },
  ];
  const responder = (removed: string[]) => vi.fn(async (_profile: string, _name: string, args: Record<string, unknown>) => {
    if (args.action === "list") return { text: JSON.stringify({ rows, kept: 2, failedRepos: [] }), isError: false };
    if (args.dryRun) {
      const items = args.items as Array<{ repo: string; path: string }>;
      return { text: JSON.stringify({ dryRun: true, ok: true, removed: items.filter((item) => removed.includes(item.path)).map((item) => item.path), skipped: items.filter((item) => !removed.includes(item.path)).map((item) => ({ ...item, reason: "it has uncommitted changes" })) }), isError: false };
    }
    return { text: JSON.stringify({ dryRun: false, ok: true, removed: (args.items as Array<{ path: string }>).map((item) => item.path), skipped: [] }), isError: false };
  });

  it("lists branch, path and state, puts clean ones first, and offers Clean up N", async () => {
    const call = responder(["/wt/app-merged", "/wt/api-run"]);
    const { router, jev } = build([cleanup], { call });
    const [card] = await router.handle("worktrees", context);
    const body = JSON.stringify(card.blocks);
    expect(text(card)).toContain("Worktrees · 3");
    expect(body).toContain("feat/a");
    expect(body).toContain("/wt/app-merged");
    expect(body).toContain("PR #12 merged");
    expect(body).toContain("agent run finished");
    expect(body).toContain("dirty");
    expect(body).toContain("Clean up 2");
    expect(body).toContain("2 more in use or locked");
    expect(body.indexOf("feat/a")).toBeLessThan(body.indexOf("feat/b"));
    expect(call.mock.calls.every(([, , args]) => args.action === "list" || args.dryRun === true)).toBe(true);
    expect(jev).not.toHaveBeenCalled();
  });

  it("Clean up N only previews: exactly what goes, what is skipped, and a red Confirm that names the count", async () => {
    const call = responder(["/wt/app-merged", "/wt/api-run"]);
    const { router } = build([cleanup], { call });
    const [card] = await router.handle("worktrees", context);
    call.mockClear();
    const view = await router.interact(interaction("devhub_tool_view", buttonValue(card, "devhub_tool_view")));
    expect(call).toHaveBeenCalledExactlyOnceWith("work", "repos_worktree_cleanup", { action: "remove", items: [{ repo: "app", path: "/wt/app-merged" }, { repo: "api", path: "/wt/api-run" }], dryRun: true });
    const preview = view.post[0];
    const body = JSON.stringify(preview.blocks);
    expect(text(preview)).toContain("Remove 2 worktrees?");
    expect(body).toContain("/wt/app-merged");
    expect(body).toContain("/wt/api-run");
    expect(body).toContain("can't be undone");
    expect(body).toContain("\"danger\"");
    expect(body).toContain("Yes, remove 2");
    const confirmId = buttonValue(preview, "devhub_tool_confirm");
    const done = await router.interact(interaction("devhub_tool_confirm", confirmId));
    expect(call).toHaveBeenLastCalledWith("work", "repos_worktree_cleanup", { action: "remove", items: [{ repo: "app", path: "/wt/app-merged" }, { repo: "api", path: "/wt/api-run" }], confirm: true });
    expect(text(done.post[0])).toContain("Removed");
  });

  it("lists anything that turned dirty in between as skipped, and removes only what is still clean", async () => {
    const first = responder(["/wt/app-merged", "/wt/api-run"]);
    const { router, call } = build([cleanup], { call: first });
    const [card] = await router.handle("worktrees", context);
    call.mockImplementation(responder(["/wt/app-merged"]));
    const view = await router.interact(interaction("devhub_tool_view", buttonValue(card, "devhub_tool_view")));
    const preview = view.post[0];
    expect(text(preview)).toContain("Remove 1 worktree?");
    expect(JSON.stringify(preview.blocks)).toContain("Skipped, left as they are");
    expect(JSON.stringify(preview.blocks)).toContain("it has uncommitted changes");
    await router.interact(interaction("devhub_tool_confirm", buttonValue(preview, "devhub_tool_confirm")));
    expect(call).toHaveBeenLastCalledWith("work", "repos_worktree_cleanup", { action: "remove", items: [{ repo: "app", path: "/wt/app-merged" }], confirm: true });
  });

  it("Cancel removes nothing, and with nothing clean there is no button at all", async () => {
    const call = responder(["/wt/app-merged"]);
    const { router } = build([cleanup], { call });
    const [card] = await router.handle("worktrees", context);
    const preview = (await router.interact(interaction("devhub_tool_view", buttonValue(card, "devhub_tool_view")))).post[0];
    call.mockClear();
    const cancelled = await router.interact(interaction("devhub_tool_cancel", buttonValue(preview, "devhub_tool_confirm")));
    expect(cancelled.update?.text).toContain("Cancelled");
    expect(call).not.toHaveBeenCalled();
    const [none] = await build([cleanup], { call: responder([]) }).router.handle("worktrees", context);
    expect(JSON.stringify(none.blocks)).not.toContain("Clean up");
    expect(JSON.stringify(none.blocks)).not.toContain("devhub_tool_view");
  });

  it("copes with no worktrees, a missing tool and a failing list", async () => {
    const empty = vi.fn(async () => ({ text: JSON.stringify({ rows: [], kept: 0, failedRepos: [] }), isError: false }));
    expect(text((await build([cleanup], { call: empty }).router.handle("worktrees", context))[0])).toContain("Worktrees · 0");
    expect(text((await build([]).router.handle("worktrees", context))[0])).toContain("isn't available");
    const failing = vi.fn(async () => ({ text: "gh not signed in", isError: true }));
    expect(text((await build([cleanup], { call: failing }).router.handle("worktrees", context))[0])).toContain("Couldn't list");
  });
});

describe("Plan and Implement from a Needs-you card", () => {
  const day = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
  const planAgent = tool("tasks_agent_plan", { readOnly: false, required: ["taskId", "date"], properties: { taskId: { type: "string" }, date: day } });
  const resume = tool("tasks_agent_resume", { readOnly: false, required: ["taskId", "date"], properties: { taskId: { type: "string" }, date: day } });
  const target = { profile: "work", taskId: "task-1", channel: "CCHANNEL", threadTs: "9.9", teamId: "TTEAM", userId: "UOWNER" };
  const found = vi.fn(async () => [{ taskId: "task-1", date: "2026-10-12", title: "Fix", profile: "work" }]);

  it("Plan posts a Confirm card that says plan-only, and runs nothing until it is confirmed", async () => {
    const { router, call, jev } = build([planAgent, resume], { findTasks: found });
    const [card] = await router.propose("plan", target);
    expect(text(card)).toContain("Run tasks_agent_plan in work?");
    expect(text(card)).toContain("Plan only — stops after the plan.");
    expect(card.thread_ts).toBe("9.9");
    expect(call).not.toHaveBeenCalled();
    expect(jev).not.toHaveBeenCalled();
    await router.interact(interaction("devhub_tool_confirm", buttonValue(card, "devhub_tool_confirm")));
    expect(call).toHaveBeenCalledExactlyOnceWith("work", "tasks_agent_plan", { taskId: "task-1", date: "2026-10-12" });
  });

  it("Implement goes to a Confirm card for tasks_agent_resume", async () => {
    const { router, call } = build([planAgent, resume], { findTasks: found });
    const [card] = await router.propose("implement", target);
    expect(text(card)).toContain("Run tasks_agent_resume in work?");
    expect(call).not.toHaveBeenCalled();
  });

  it("says so when the task or the tool is gone, and starts nothing", async () => {
    const { router, call } = build([planAgent], { findTasks: async () => [] });
    expect(text((await router.propose("plan", target))[0])).toContain("couldn't find that task");
    expect(text((await build([planAgent], { findTasks: found }).router.propose("implement", target))[0])).toContain("isn't available");
    expect(call).not.toHaveBeenCalled();
  });
});


describe("✅ reaction: check the task off", () => {
  const day = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
  const update = tool("tasks_update", { readOnly: false, required: ["id"], properties: { id: { type: "string" }, date: day, status: { type: "string", enum: ["complete", "abandon", "reactivate"] } } });
  const open = { taskId: "task-1", date: "2026-10-12", title: "Fix the ad slot", profile: "work", own: true };
  const target = { profile: "work", taskId: "task-1", channel: "CCHANNEL", threadTs: "9.9", teamId: "TTEAM", userId: "UOWNER" };
  const respond = () => vi.fn(async (_profile: string, name: string, args: Record<string, unknown>) => ({ text: name === "tasks_update" ? `Updated task: ${args.id} — Fix the ad slot (done=true, stage=ready)` : "{}", isError: false }));

  it("uses the done KEY path: checks it off now, replies in the message's thread with Checked off and Undo", async () => {
    const call = respond();
    const { router, jev, model } = build([update], { call, findTasks: async () => [open] });
    const [card] = await router.checkOff(target);
    expect(call).toHaveBeenCalledExactlyOnceWith("work", "tasks_update", { id: "task-1", date: "2026-10-12", status: "complete" });
    expect(text(card)).toContain("Checked off · Fix the ad slot");
    expect(card.thread_ts).toBe("9.9");
    expect(JSON.stringify(card.blocks)).toContain("devhub_tool_undo");
    expect(card.taskRef).toMatchObject({ profile: "work", taskId: "task-1", title: "Fix the ad slot" });
    expect(jev).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    const undo = await router.interact(interaction("devhub_tool_undo", buttonValue(card, "devhub_tool_undo")));
    expect(call).toHaveBeenLastCalledWith("work", "tasks_update", { id: "task-1", date: "2026-10-12", status: "reactivate" });
    expect(undo.update?.text).toContain("Undone");
  });
  it("says nothing for a task that is already done, so a stray ✅ adds no noise", async () => {
    const call = respond();
    const { router } = build([update], { call, findTasks: async () => [{ ...open, done: true }] });
    expect(await router.checkOff(target)).toEqual([]);
    expect(call).not.toHaveBeenCalled();
  });
  it("won't check off a task an agent is still working on, and says why", async () => {
    const call = respond();
    const { router } = build([update], { call, findTasks: async () => [{ ...open, running: true }] });
    const [reply] = await router.checkOff(target);
    expect(text(reply)).toContain("still has work running");
    expect(call).not.toHaveBeenCalled();
  });
  it("reports a missing task or an unavailable tool without calling anything", async () => {
    const call = respond();
    expect(text((await build([update], { call, findTasks: async () => [] }).router.checkOff(target))[0])).toContain("couldn't find that task");
    expect(text((await build([tool("notes_list")], { call, findTasks: async () => [open] }).router.checkOff(target))[0])).toContain("isn't available");
    expect(call).not.toHaveBeenCalled();
  });
  it("posts the add-task reply with the task it is about, so a ✅ on it works", async () => {
    const capture = tool("tasks_capture", { readOnly: false, required: ["text"], properties: { text: { type: "string", maxLength: 500 } } });
    const call = vi.fn(async () => ({ text: "Captured draft new-1 on 2026-10-18: Buy milk\nNote: x", isError: false }));
    const { router } = build([capture], { call });
    const [card] = await router.handle("add task Buy milk", context);
    expect(card.taskRef).toMatchObject({ profile: "work", taskId: "new-1", title: "Buy milk" });
  });
});

describe("complete catalog routing and answer tiers", () => {
  const winner = (preferred: string[]) => (question: JevQuestion) => preferred.find((id) => question.options.some((option) => option.id === id)) ?? "special:unsupported";

  it.each([false, true])("reaches the final tool beyond both option limits (many categories: %s)", async (categories) => {
    const tools = Array.from({ length: 400 }, (_, index) => tool(`g${index}_read`, { category: categories ? `g${index}` : "one" }));
    const choose = winner(["tool:g399_read", "cat:g399", "cat:one"]);
    const jev = jevPicks(...Array.from({ length: 20 }, () => choose));
    const { router, call } = build(tools, { jev });
    await router.handle("perform the obscure operation", context);
    expect(call).toHaveBeenCalledWith("work", "g399_read", {});
    expect(jev.mock.calls.every(([question]) => question.options.length <= 255)).toBe(true);
    const offered = new Set(jev.mock.calls.flatMap(([question]) => question.options.map((option) => option.id)));
    for (const tool of tools) expect(offered.has(categories ? "cat:" + tool.category : "tool:" + tool.name)).toBe(true);
    expect(slackUsageTotals(root).jevCalls).toBe(jev.mock.calls.length);
    expect(slackUsageTotals(root).jevCostUsd).toBeCloseTo(jev.mock.calls.length * 0.0001);
  });

  it("skips the category question for a unique task keyword and keeps every sibling", async () => {
    const siblings = [tool("task_note_list"), tool("tasks_agent_status"), tool("tasks_list")];
    const jev = jevPicks("tool:task_note_list");
    const { router, call } = build([...siblings, ...Array.from({ length: 70 }, (_, i) => tool("misc_" + i))], { jev });
    await router.handle("explain my task history", context);
    expect(jev).toHaveBeenCalledOnce();
    for (const sibling of siblings) expect(jev.mock.calls[0][0].options.map((option) => option.id)).toContain("tool:" + sibling.name);
    expect(call).toHaveBeenCalledWith("work", "task_note_list", {});
  });

  it("lets Jev choose an enum sub-call and still confirms writes with those exact args", async () => {
    const operation = tool("external_ops", { readOnly: false, properties: { action: { type: "string", enum: ["list", "delete"] } }, required: ["action"] });
    const { router, call, model } = build([operation], { jev: jevPicks("call:external_ops:1") });
    const [card] = await router.handle("delete the external things", context);
    expect(model).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    await router.interact(interaction("devhub_tool_confirm", buttonValue(card, "devhub_tool_confirm")));
    expect(call).toHaveBeenCalledWith("work", "external_ops", { action: "delete" });
  });

  it("keeps selected enum args through an ambiguous pick before Confirm", async () => {
    const operation = tool("external_ops", { readOnly: false, properties: { op: { enum: ["list", "delete"] } }, required: ["op"] });
    const { router, call } = build([operation], { jev: jevPicks(["call:external_ops:1", 0.4]) });
    const [pick] = await router.handle("the external thing", context);
    const chosen = await router.interact(interaction("devhub_tool_pick_1", buttonValue(pick, "devhub_tool_pick_1")));
    expect(call).not.toHaveBeenCalled();
    const [card] = chosen.post;
    expect(card.text).toContain("Run external_ops");
    await router.interact(interaction("devhub_tool_confirm", buttonValue(card, "devhub_tool_confirm")));
    expect(call).toHaveBeenCalledWith("work", "external_ops", { op: "delete" });
  });

  it("fills nested required details while keeping Jev's selected operation", async () => {
    const nested = tool("external_request", { readOnly: false, properties: { request: { type: "object", properties: { op: { enum: ["read", "delete"] }, id: { type: "string" } }, required: ["op", "id"] } } });
    const model = vi.fn(async (): Promise<CheapModelResult> => ({ ok: true, text: '{"request":{"op":"delete","id":"123"}}', label: "cheap" }));
    const { router, call } = build([nested], { jev: jevPicks("call:external_request:0"), model });
    const [card] = await router.handle("read external request 123", context);
    expect(model).toHaveBeenCalledOnce(); expect(call).not.toHaveBeenCalled();
    await router.interact(interaction("devhub_tool_confirm", buttonValue(card, "devhub_tool_confirm")));
    expect(call).toHaveBeenCalledWith("work", "external_request", { request: { op: "read", id: "123" } });
  });

  it("preserves profile phrases inside explicit JSON and skips catalog discovery for free cards", async () => {
    const current = build([tool("echo", { properties: { text: { type: "string" } }, required: ["text"] })]);
    await current.router.handle('run echo {"text":"review in work"}', context);
    expect(current.call).toHaveBeenCalledWith("work", "echo", { text: "review in work" });
    current.catalog.tools.mockClear();
    await current.router.handle("prs", context);
    await current.router.handle("meetings today", context);
    expect(current.catalog.tools).not.toHaveBeenCalled();
  });

  it("supports explicit names and JSON without Jev, rejects invalid args, and confirms writes", async () => {
    const operation = tool("external.ops-v2", { readOnly: false, properties: { kind: { enum: ["save"] } }, required: ["kind"] });
    const { router, call, jev, model } = build([operation]);
    expect((await router.handle('run external.ops-v2 {"kind":"bad"}', context))[0].text).toContain("Nothing was run");
    const [card] = await router.handle('run external.ops-v2 {"kind":"save"}', context);
    expect(call).not.toHaveBeenCalled();
    await router.interact(interaction("devhub_tool_confirm", buttonValue(card, "devhub_tool_confirm")));
    expect(call).toHaveBeenCalledWith("work", "external.ops-v2", { kind: "save" });
    expect(jev).not.toHaveBeenCalled(); expect(model).not.toHaveBeenCalled();
  });

  it.each(["mid", "heavy"] as const)("runs Jev's %s answer in the background, retains tool results, and accounts once", async (tier) => {
    const longResult = "x".repeat(1000) + "Distinct result at the end";
    const answerModel = vi.fn(async (): Promise<CheapModelResult> => ({ ok: true, text: "A concise analysis.", label: "Configured model" }));
    let work: ((signal: AbortSignal) => Promise<import("./client").SlackMessage[]>) | undefined;
    const background = vi.fn(async (_ack, job) => { work = job; });
    const current = build([tool("read_data")], {
      call: vi.fn(async () => ({ text: longResult, isError: false })),
      jev: jevPicks(`special:chat:${tier}`), answerTiers: () => ["cheap", tier], answerModel,
    });
    await current.router.handle("run read_data {}", context);
    const before = slackUsageTotals(root);
    expect(await current.router.handle("analyse all of that", { ...context, background })).toEqual([]);
    expect(background.mock.calls[0][0].text).toContain(tier);
    expect(answerModel).not.toHaveBeenCalled();
    expect(slackUsageTotals(root).queries).toBe(before.queries);
    const replies = await work!(new AbortController().signal);
    expect(replies[0].text).toBe("A concise analysis.");
    expect(answerModel).toHaveBeenCalledWith(tier, expect.objectContaining({ prompt: expect.stringContaining("Distinct result at the end"), maxOutputTokens: 700 }));
    expect(slackUsageTotals(root)).toMatchObject({ queries: before.queries + 1, modelCalls: 1, jevCalls: 1 });
    expect(JSON.parse(fs.readFileSync(path.join(root, "usage.jsonl"), "utf8").trim().split("\n").at(-1)!)).toMatchObject({ route: "model", modelTier: tier });
  });

  it("never offers unconfigured answer tiers, or uses a heavy tier for argument filling", async () => {
    const jev = jevPicks("tool:needs_args");
    const answerModel = vi.fn();
    const { router, model } = build([tool("needs_args", { required: ["id"], properties: { id: { type: "string" } } })], { jev, answerTiers: () => ["cheap"], answerModel });
    await router.handle("do the obscure thing", context);
    expect(jev.mock.calls[0][0].options.map((option) => option.id)).not.toContain("special:chat:heavy");
    expect(model).toHaveBeenCalledOnce();
    expect(answerModel).not.toHaveBeenCalled();
  });

  it.each(["profile", "teamId", "userId", "channel", "threadTs"] as const)("does not leak thread history across %s", async (field) => {
    const model = vi.fn<(request: { prompt: string }) => Promise<CheapModelResult>>(async () => ({ ok: true, text: "Private answer", label: "cheap" }));
    const jev = jevPicks("special:clarify", "special:clarify");
    const { router } = build([tool("read_data")], { jev, model });
    await router.handle("private question", context);
    await router.handle("unrelated question", { ...context, [field]: "different" });
    expect(jev.mock.calls[1][0].options.map((option) => option.id)).not.toContain("special:thread");
    expect(model.mock.calls[1][0].prompt).not.toContain("private question");
  });

  it("records a failed model call without substituting another tier", async () => {
    const model = vi.fn(async (): Promise<CheapModelResult> => ({ ok: false, reason: "failed" }));
    const { router } = build([], { jev: jevPicks("special:clarify"), model });
    await router.handle("explain the thing", context);
    expect(slackUsageTotals(root)).toMatchObject({ queries: 1, modelCalls: 1, jevCalls: 1 });
  });
});

describe("plugin tools in Slack", () => {
  const fake = (name: string, extra: Partial<SlackTool> = {}) => tool(name, { plugin: "fake-plugin", category: "plugin:fake-plugin", ...extra });
  const core = Array.from({ length: 70 }, (_, i) => tool(`core${i % 7}_tool${i}`, { category: `core${i % 7}` }));

  it("lists a plugin's tools as their own Jev group and lets Jev pick one of them", async () => {
    const lookup = fake("fake_lookup", { description: "Looks things up in the fake system" });
    const jev = jevPicks("cat:plugin:fake-plugin", "tool:fake_lookup");
    const { router, call } = build([...core, lookup, fake("fake_other")], { jev });
    const [reply] = await router.handle("look the thing up in the fake system", context);
    const [first, second] = jev.mock.calls.map(([question]) => question);
    expect(first.options.find((option) => option.id === "cat:plugin:fake-plugin")?.description).toContain("plugin:fake-plugin: fake_lookup, fake_other");
    expect(second.options.filter((option) => option.id.startsWith("tool:")).map((option) => option.id).sort()).toEqual(["tool:fake_lookup", "tool:fake_other"]);
    expect(call).toHaveBeenCalledWith("work", "fake_lookup", {});
    expect(text(reply)).toContain("fake_lookup");
  });
  it("has no tool count baked in: any catalog size works, and the refresh message counts plugin tools", async () => {
    const tools = vi.fn(async () => [tool("a_one"), fake("fake_lookup"), fake("fake_other")]);
    const router = new SlackToolRouter({ catalog: { tools, call: vi.fn(), close: vi.fn() }, jev: jevPicks(), model: vi.fn(), confirms: new ToolConfirmStore(root), record: () => {}, totals: slackUsageTotals as never });
    const [reply] = await router.handle("refresh the tools", context);
    expect(text(reply)).toContain("3 DevHub tools in 2 groups (2 from plugins)");
  });
  it("runs an annotated read-only plugin tool without asking", async () => {
    const { router, call } = build([fake("fake_lookup")], { jev: jevPicks("tool:fake_lookup") });
    await router.handle("look something up", context);
    expect(call).toHaveBeenCalledExactlyOnceWith("work", "fake_lookup", {});
  });
  it("stops an unannotated plugin tool at a Confirm card (not red) that says why, and runs nothing until Confirm", async () => {
    const unrated = fake("fake_sync", { readOnly: false, destructive: false, unrated: true });
    const { router, call } = build([unrated], { jev: jevPicks("tool:fake_sync") });
    const [card] = await router.handle("sync the fake system", context);
    expect(call).not.toHaveBeenCalled();
    expect(text(card)).toContain("Run fake_sync in work?");
    expect(JSON.stringify(card.blocks)).toContain("doesn't say whether it changes anything");
    expect(JSON.stringify(card.blocks)).not.toContain("danger");
    expect(JSON.stringify(card.blocks)).not.toContain("can't be undone");
    const done = await router.interact(interaction("devhub_tool_confirm", buttonValue(card, "devhub_tool_confirm")));
    expect(call).toHaveBeenCalledWith("work", "fake_sync", {});
    expect(done.update?.text).toContain("Confirmed");
  });
  it("gives a plugin tool that says it is destructive the red button and the warning", async () => {
    const destructive = fake("fake_wipe", { readOnly: false, destructive: true });
    const { router, call } = build([destructive], { jev: jevPicks("tool:fake_wipe") });
    const [card] = await router.handle("wipe the fake system", context);
    expect(call).not.toHaveBeenCalled();
    expect(JSON.stringify(card.blocks)).toContain("danger");
    expect(JSON.stringify(card.blocks)).toContain("can't be undone");
  });
});
