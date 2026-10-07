import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";
import { formatDetail, formatOverview, formatPrefs, registerConventionsTools } from "./conventions.ts";

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function setup(responses: { get?: unknown; post?: unknown } = {}) {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler),
  } as unknown as McpServer;
  const get = vi.fn().mockResolvedValue(responses.get ?? {});
  const post = vi.fn().mockResolvedValue(responses.post ?? { ok: true });
  registerConventionsTools(server, { dashboard: { get, post } } as unknown as Context);
  const call = (name: string, args: Record<string, unknown> = {}) => handlers.get(name)!(args);
  return { call, get, post, names: [...handlers.keys()] };
}

describe("registration", () => {
  it("covers reading, refreshing, reviewing and settings", () => {
    expect(setup().names.sort()).toEqual(["conventions_list", "conventions_mine", "conventions_review", "conventions_settings", "repo_conventions"]);
  });
});

describe("repo_conventions", () => {
  it("returns the rules when there are some, asking the dashboard to start a run if there are none", async () => {
    const { call, get } = setup({ get: { repo: "o/r", status: "ready", markdown: "# Conventions — o/r\n- A rule" } });
    expect((await call("repo_conventions", { repo: "r" })).content[0].text).toContain("A rule");
    expect(get).toHaveBeenCalledWith("/api/conventions", { repo: "r", format: "markdown", ensure: "1" });
  });

  it("says plainly when it is still mining, and when there is nothing", async () => {
    expect((await setup({ get: { repo: "o/r", status: "mining", markdown: "" } }).call("repo_conventions", { repo: "o/r" })).content[0].text).toMatch(/being mined/);
    expect((await setup({ get: { repo: "o/r", status: "none", markdown: "" } }).call("repo_conventions", { repo: "o/r" })).content[0].text).toMatch(/No conventions recorded/);
  });
});

describe("conventions_list filtering", () => {
  it("lists rejected candidates with their automatic decision reasons", async () => {
    const common = { category: "structure", origin: "review", active: false, prs: [], evidence: [] };
    const { call } = setup({ get: { repo: "o/r", mining: false, storedAt: "/vault/r.json", file: { runs: [], rules: [
      { ...common, id: "r_active", text: "A supported layout convention", status: "accepted", active: true },
      { ...common, id: "r_rejected", text: "Invert every boolean condition", status: "rejected", automaticDecision: { status: "rejected", reason: "This was a one-off bug correction.", at: "2026-10-06T00:00:00Z" } },
    ] } } });
    const out = (await call("conventions_list", { repo: "o/r", status: "rejected" })).content[0].text;
    expect(out).toContain("r_rejected");
    expect(out).toContain("automatically rejected");
    expect(out).toContain("Decision: This was a one-off bug correction.");
    expect(out).not.toContain("r_active");
  });
});

describe("conventions_mine", () => {
  it("starts a run and passes force through", async () => {
    const { call, post } = setup({ post: { started: true } });
    expect((await call("conventions_mine", { repo: "o/r", force: true })).content[0].text).toMatch(/Mining o\/r in the background/);
    expect(post).toHaveBeenCalledWith("/api/conventions", { action: "mine", repo: "o/r", force: true }, 30_000);
  });

  it("reports a run already in flight", async () => {
    expect((await setup({ post: { started: false } }).call("conventions_mine", { repo: "o/r" })).content[0].text).toMatch(/already being mined/);
  });
});

describe("conventions_review", () => {
  it("returns decision receipts and maps undo without a rule id", async () => {
    const { call, post } = setup({ post: { undoToken: "receipt" } });
    expect((await call("conventions_review", { repo: "o/r", action: "reject", ruleId: "r_1" })).content[0].text).toContain("Undo token: receipt");
    await call("conventions_review", { repo: "o/r", action: "undo", undoToken: "receipt" });
    expect(post).toHaveBeenLastCalledWith("/api/conventions", { action: "undo", repo: "o/r", token: "receipt" });
    const missing = setup();
    expect(await missing.call("conventions_review", { repo: "o/r", action: "undo" })).toMatchObject({ isError: true });
    expect(missing.post).not.toHaveBeenCalled();
  });

  it("maps accept, reject and restore onto the status action", async () => {
    const { call, post } = setup();
    await call("conventions_review", { repo: "o/r", action: "accept", ruleId: "r_1" });
    await call("conventions_review", { repo: "o/r", action: "reject", ruleId: "r_1" });
    await call("conventions_review", { repo: "o/r", action: "restore", ruleId: "r_1" });
    expect(post.mock.calls.map((c) => (c[1] as { status: string }).status)).toEqual(["accepted", "rejected", "accepted"]);
    expect(post.mock.calls[0][1]).toMatchObject({ action: "status", repo: "o/r", ruleId: "r_1" });
  });

  it("sends edit and add with their fields", async () => {
    const { call, post } = setup();
    await call("conventions_review", { repo: "o/r", action: "edit", ruleId: "r_1", text: "New wording here", category: "config" });
    await call("conventions_review", { repo: "o/r", action: "add", text: "Keep fixtures next to the test", scope: "test/**" });
    expect(post.mock.calls[0][1]).toMatchObject({ action: "edit", ruleId: "r_1", text: "New wording here", category: "config" });
    expect(post.mock.calls[1][1]).toMatchObject({ action: "add", text: "Keep fixtures next to the test", scope: "test/**" });
  });

  it("refuses a missing rule id, missing text, and an unconfirmed delete — without calling the dashboard", async () => {
    const { call, post } = setup();
    expect(await call("conventions_review", { repo: "o/r", action: "accept" })).toMatchObject({ isError: true });
    expect(await call("conventions_review", { repo: "o/r", action: "add" })).toMatchObject({ isError: true });
    expect(await call("conventions_review", { repo: "o/r", action: "delete", ruleId: "r_1" })).toMatchObject({ isError: true });
    expect(post).not.toHaveBeenCalled();
  });

  it("deletes once confirmed", async () => {
    const { call, post } = setup();
    await call("conventions_review", { repo: "o/r", action: "delete", ruleId: "r_1", confirm: true });
    expect(post).toHaveBeenCalledWith("/api/conventions", { action: "delete", repo: "o/r", ruleId: "r_1" });
  });
});

describe("conventions_settings", () => {
  const prefs = { enabled: true, prLimit: 30, minIntervalHours: 12, provider: "", model: "" };

  it("reads when given nothing", async () => {
    const { call, get, post } = setup({ get: { prefs, providers: [{ id: "cursor-cli", label: "Cursor CLI", available: true }], resolved: "cursor-cli", defaultModels: {} } });
    const out = (await call("conventions_settings")).content[0].text;
    expect(get).toHaveBeenCalledWith("/api/conventions", { settings: "1" });
    expect(post).not.toHaveBeenCalled();
    expect(out).toContain("PRs read per run: 30");
    expect(out).toContain("default resolves to cursor-cli");
  });

  it("saves only the fields it was given", async () => {
    const { call, post } = setup({ post: { prefs: { ...prefs, model: "big-model" } } });
    const out = (await call("conventions_settings", { model: "big-model", provider: undefined })).content[0].text;
    expect(post).toHaveBeenCalledWith("/api/conventions", { action: "prefs", prefs: { model: "big-model" } });
    expect(out).toContain("Model: big-model");
  });

  it("lets an empty string clear the model", async () => {
    const { call, post } = setup({ post: { prefs } });
    await call("conventions_settings", { model: "" });
    expect(post).toHaveBeenCalledWith("/api/conventions", { action: "prefs", prefs: { model: "" } });
  });
});

describe("formatting", () => {
  const rule = (over: Record<string, unknown> = {}) => ({
    id: "r_1",
    text: "Put each handler in its own file",
    category: "structure",
    status: "suggested" as const,
    origin: "review" as const,
    active: false,
    prs: [1078],
    evidence: [{ label: "PR #1078", quote: "Use a separate file for each handler.", url: "https://github.com/a/b/pull/1078#discussion_r1" }, { label: "AGENTS.md", quote: "Keep handlers separate." }],
    ...over,
  });

  it("summarises the overview, flags failures, and says what unmined repos do", () => {
    const out = formatOverview({
      repos: [
        { repo: "a/b", rules: 12, active: 7, toReview: 3, lastMinedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), lastRunOk: true, mining: false },
        { repo: "a/c", rules: 0, active: 0, toReview: 0, lastMinedAt: null, lastRunOk: false, mining: false },
      ],
      candidates: ["a/d"],
    });
    expect(out).toContain("2 repos mined, 7 active rules");
    expect(out).toContain("a/b — 12 rules (7 active, 0 rejected) · mined 2h ago");
    expect(out).toContain("a/c — 0 rules (0 active, 0 rejected) · last run FAILED");
    expect(out).toContain("Not mined yet (they mine themselves on the first review or new PR there): a/d");
  });

  it("lists rules with ids, status and where the file is stored", () => {
    const out = formatDetail({
      repo: "a/b",
      mining: false,
      storedAt: "/vault/.config/conventions/a__b.json",
      file: {
        rules: [rule(), rule({ id: "r_2", status: "accepted", acceptedBy: "pr", active: true, text: "Other" })],
        runs: [{ at: new Date().toISOString(), ok: true, prsScanned: 10, comments: 27, added: 12, autoAccepted: 1, reinforced: 0, provider: "cursor-cli", model: "default" }],
      },
    });
    expect(out).toContain("Stored at /vault/.config/conventions/a__b.json");
    expect(out).toContain("https://github.com/a/b/pull/1078#discussion_r1");
    expect(out).toContain('"Use a separate file for each handler."');
    expect(out).toContain("r_1 [structure · awaiting automatic assessment · 1 PR · 2 evidence] Put each handler in its own file");
    expect(out).toContain("r_2 [structure · auto-accepted (author agreement) · 1 PR · 2 evidence] Other");
    expect(out).toContain("+12 new · 1 automatically accepted");
  });

  it("explains an empty repo and a failed run", () => {
    expect(formatDetail({ repo: "a/b", mining: false, storedAt: "/x.json", file: null })).toMatch(/No rules yet/);
    const failed = formatDetail({
      repo: "a/b",
      mining: false,
      storedAt: "/x.json",
      file: { rules: [], runs: [{ at: new Date().toISOString(), ok: false, error: "cursor-agent not found", prsScanned: 0, comments: 0, added: 0, reinforced: 0 }] },
    });
    expect(failed).toContain("FAILED — cursor-agent not found");
  });

  it("formats prefs with blanks spelled out", () => {
    expect(formatPrefs({ enabled: false, prLimit: 20, minIntervalHours: 6, provider: "", model: "" })).toContain("Provider: default\nModel: provider default");
  });
});
