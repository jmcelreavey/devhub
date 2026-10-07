import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";
import { DashboardHttpError } from "../dashboard-client.ts";
import { formatDraft, formatList, registerVoiceTools } from "./voice.ts";

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function setup(responses: { get?: unknown; post?: unknown; put?: unknown } = {}) {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler),
  } as unknown as McpServer;
  const get = vi.fn().mockResolvedValue(responses.get ?? {});
  const post = vi.fn().mockResolvedValue(responses.post ?? { ok: true });
  const put = vi.fn().mockResolvedValue(responses.put ?? { answers: [] });
  registerVoiceTools(server, { dashboard: { get, post, put } } as unknown as Context);
  const call = (name: string, args: Record<string, unknown> = {}) => handlers.get(name)!(args);
  return { call, get, post, put, names: [...handlers.keys()] };
}

const scenarios = [
  { id: "slack-a", register: "slack", situation: "A teammate proposes a library.", task: "Reply." },
  { id: "email-b", register: "email", situation: "Someone hasn't replied.", task: "Chase them." },
  { id: "pr-c", register: "pr", situation: "A variable is badly named.", task: "Leave a comment." },
];
const hours = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const state = (overrides: Record<string, unknown> = {}) => ({
  scenarios,
  answers: [
    { scenarioId: "slack-a", answer: "No to the library,\nhonestly.", answeredAt: hours(5), trainedAt: hours(1) },
    { scenarioId: "email-b", answer: "Just chasing this one", answeredAt: hours(2) },
  ],
  skill: { found: true, readOnly: false, learnedModified: Date.now() - 3_600_000 },
  aiConfigured: true,
  ...overrides,
});

describe("registration", () => {
  it("covers listing, answering, drafting and saving", () => {
    expect(setup().names.sort()).toEqual(["voice_answer", "voice_apply", "voice_list", "voice_train"]);
  });
});

describe("voice_list", () => {
  it("summarises progress and marks each scenario learned, new or unanswered", async () => {
    const out = (await setup({ get: state() }).call("voice_list")).content[0].text;
    expect(out).toContain("2/3 answered · 1 new since the last update · learned-voice.md updated 1h ago");
    expect(out).toContain("- slack-a [slack] answered, learned");
    expect(out).toContain("- email-b [email] answered, new");
    expect(out).toContain("- pr-c [pr] not answered");
  });

  it("tells the agent to ask the user rather than answer for them", async () => {
    const out = (await setup({ get: state() }).call("voice_list")).content[0].text;
    expect(out).toContain("Ask the user for their own answer");
    expect(out).toContain("voice_train drafts an update");
  });

  it("filters to unanswered, new or answered scenarios", () => {
    expect(formatList(state() as never, { filter: "unanswered" })).toMatch(/pr-c[\s\S]*$/);
    expect(formatList(state() as never, { filter: "unanswered" })).not.toContain("slack-a [");
    expect(formatList(state() as never, { filter: "new" })).toContain("email-b");
    expect(formatList(state() as never, { filter: "new" })).not.toContain("slack-a [");
    expect(formatList(state() as never, { filter: "answered" })).not.toContain("pr-c [");
  });

  it("clips answers in the list but returns the whole answer for one scenario", () => {
    const long = "word ".repeat(100).trim();
    const s = state({ answers: [{ scenarioId: "slack-a", answer: long, answeredAt: hours(1) }] }) as never;
    expect(formatList(s)).toContain("…");
    expect(formatList(s, { scenarioId: "slack-a" })).toContain(JSON.stringify(long));
  });

  it("says plainly what is blocking training", () => {
    const out = formatList(state({ skill: { found: true, readOnly: true, learnedModified: null }, aiConfigured: false }) as never);
    expect(out).toContain("not trained yet");
    expect(out).toContain("read-only");
    expect(out).toContain("No AI provider is configured");
    expect(formatList(state({ skill: { found: false, readOnly: false, learnedModified: null } }) as never)).toContain("isn't installed");
  });

  it("rejects an unknown scenario id", async () => {
    expect(await setup({ get: state() }).call("voice_list", { scenarioId: "nope" })).toMatchObject({ isError: true });
  });

  it("reports an empty filter instead of printing nothing", () => {
    expect(formatList(state({ answers: [] }) as never, { filter: "new" })).toContain("(nothing matches)");
  });
});

describe("voice_answer", () => {
  it("saves the answer as given and reports how much is waiting to be learned", async () => {
    const { call, put } = setup({ put: { answers: [{ scenarioId: "email-b", answer: "x", answeredAt: hours(1) }] } });
    const out = (await call("voice_answer", { scenarioId: "email-b", answer: "Just chasing this one" })).content[0].text;
    expect(put).toHaveBeenCalledWith("/api/voice", { scenarioId: "email-b", answer: "Just chasing this one" });
    expect(out).toBe("Saved their answer to email-b. 1 new answer since the last update.");
  });

  it("clears on a blank answer", async () => {
    const out = (await setup({ put: { answers: [] } }).call("voice_answer", { scenarioId: "email-b", answer: "  " })).content[0].text;
    expect(out).toContain("Cleared the answer to email-b");
    expect(out).toContain("0 new answers");
  });

  it("surfaces the dashboard's reason when the scenario is unknown", async () => {
    const { call, put } = setup();
    put.mockRejectedValue(new DashboardHttpError(404, { error: "Unknown scenario." }, "Dashboard PUT /api/voice failed (404): Unknown scenario."));
    const res = await call("voice_answer", { scenarioId: "nope", answer: "x" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Unknown scenario.");
  });
});

describe("voice_train", () => {
  it("starts a draft in the background rather than blocking on the model", async () => {
    const { call, post } = setup({ post: { started: true } });
    const out = (await call("voice_train", { action: "start" })).content[0].text;
    expect(post).toHaveBeenCalledWith("/api/voice/train", { wait: false });
    expect(out).toContain("Drafting in the background");
    expect(out).toContain("action:status");
  });

  it("says when a draft is already running", async () => {
    expect((await setup({ post: { started: false } }).call("voice_train", { action: "start" })).content[0].text).toMatch(/already running/);
  });

  it("passes on why a draft can't start", async () => {
    const { call, post } = setup();
    post.mockRejectedValue(new DashboardHttpError(409, { error: "No new answers to learn from." }, "Dashboard POST /api/voice/train failed (409): No new answers to learn from."));
    const res = await call("voice_train", { action: "start" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("No new answers to learn from.");
  });

  it("reads the draft state for status", async () => {
    const { call, get } = setup({ get: { status: "running", startedAt: hours(0) } });
    expect((await call("voice_train", { action: "status" })).content[0].text).toMatch(/^Drafting, started just now/);
    expect(get).toHaveBeenCalledWith("/api/voice/train");
  });
});

describe("formatDraft", () => {
  const ready = (current: string | null) =>
    ({
      status: "ready" as const,
      finishedAt: hours(0),
      proposal: { content: "# Learned voice\n\n- Thanks first.", answers: [{ scenarioId: "a", answeredAt: "t" }, { scenarioId: "b", answeredAt: "t" }], current },
    });

  it("shows a ready draft in full and tells the agent to get the user's approval first", () => {
    const out = formatDraft(ready(null));
    expect(out).toContain("Draft ready (2 answers");
    expect(out).toContain("Nothing is saved yet");
    expect(out).toContain("# Learned voice\n\n- Thanks first.");
    expect(out).toContain("first round");
    expect(out).toContain("confirm:true");
  });

  it("says when the draft replaces an existing file", () => {
    expect(formatDraft(ready("# Learned voice\nold"))).toContain("replaces the current learned-voice.md");
  });

  it("explains idle and failed states with the next step", () => {
    expect(formatDraft({ status: "idle" })).toContain("voice_train action:start");
    const failed = formatDraft({ status: "failed", finishedAt: hours(0), error: "cursor-agent hit its time limit" });
    expect(failed).toContain("cursor-agent hit its time limit");
    expect(failed).toContain("Start again");
  });
});

describe("voice_apply", () => {
  it("refuses without confirm, and doesn't call the dashboard", async () => {
    const { call, post } = setup();
    const res = await call("voice_apply", {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("confirm:true");
    expect(post).not.toHaveBeenCalled();
  });

  it("applies the held draft when no content is passed", async () => {
    const { call, post } = setup({ post: { ok: true, synced: true } });
    const out = (await call("voice_apply", { confirm: true })).content[0].text;
    expect(post).toHaveBeenCalledWith("/api/voice/apply", {}, 60_000);
    expect(out).toBe("Saved to my-voice and synced to the agent tools.");
  });

  it("sends the user's edited text when they changed the draft", async () => {
    const { call, post } = setup({ post: { ok: true, synced: true } });
    await call("voice_apply", { confirm: true, content: "# Learned voice\nedited" });
    expect(post).toHaveBeenCalledWith("/api/voice/apply", { content: "# Learned voice\nedited" }, 60_000);
  });

  it("reports a sync failure without calling the save a failure", async () => {
    const res = await setup({ post: { ok: true, synced: false, syncError: "EACCES" } }).call("voice_apply", { confirm: true });
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("Saved to my-voice, but syncing");
    expect(res.content[0].text).toContain("EACCES");
  });

  it("passes on a stale-draft refusal", async () => {
    const { call, post } = setup();
    post.mockRejectedValue(new DashboardHttpError(409, { error: "Your answers changed since this draft was made. Generate it again." }, "Dashboard POST /api/voice/apply failed (409): Your answers changed since this draft was made. Generate it again."));
    const res = await call("voice_apply", { confirm: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("answers changed");
  });
});
