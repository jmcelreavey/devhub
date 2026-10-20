import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRun } from "@/lib/agent-runs/store";

const daemon = vi.hoisted(() => ({
  fetchAgents: vi.fn(),
  fetchAgent: vi.fn(),
  archiveAgent: vi.fn(),
}));

vi.mock("./client", () => ({
  paseoUrl: () => "ws://127.0.0.1:6767/",
  withPaseo: (fn: (session: { daemon: typeof daemon }) => Promise<unknown>) => fn({ daemon }),
}));
vi.mock("@/lib/agent-runs/store", () => ({ listAgentRuns: () => [] }));

import { agentRuntimeIsReleasable, idleReleaseMinutes, releaseIdlePaseoRuntimes } from "./idle-runtimes";

const NOW = Date.parse("2026-10-20T20:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const CONNECTION = "ws://127.0.0.1:6767/";

function agent(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, status: "idle", updatedAt: minutesAgo(60), lastUserMessageAt: minutesAgo(70),
    archivedAt: null, requiresAttention: false, pendingPermissions: [], ...extra,
  };
}

function run(chatId: string, extra: Partial<AgentRun["status"]> = {}, runtime = "paseo"): AgentRun {
  return {
    spec: { id: `run-${chatId}`, runtime, createdAt: NOW - 3_600_000 },
    status: { state: "completed", conversationId: chatId, connectionId: CONNECTION, finishedAt: NOW - 50 * 60_000, ...extra },
    dir: "/tmp/none",
  } as unknown as AgentRun;
}

function listing(...agents: ReturnType<typeof agent>[]) {
  daemon.fetchAgents.mockResolvedValue({ entries: agents.map((a) => ({ agent: a })), pageInfo: { hasMore: false, nextCursor: null } });
  daemon.fetchAgent.mockImplementation(async (id: string) => {
    const found = agents.find((a) => a.id === id);
    return found ? { agent: found } : null;
  });
}

const release = (runs: AgentRun[], env: Record<string, string | undefined> = {}) =>
  releaseIdlePaseoRuntimes(NOW, env, () => runs);

beforeEach(() => {
  daemon.fetchAgents.mockReset();
  daemon.fetchAgent.mockReset();
  daemon.archiveAgent.mockReset().mockResolvedValue({ archivedAt: minutesAgo(0) });
});

describe("idleReleaseMinutes", () => {
  it("defaults to 15, accepts 0 to turn it off, and ignores junk", () => {
    expect(idleReleaseMinutes({})).toBe(15);
    expect(idleReleaseMinutes({ DEVHUB_PASEO_IDLE_RELEASE_MINUTES: "0" })).toBe(0);
    expect(idleReleaseMinutes({ DEVHUB_PASEO_IDLE_RELEASE_MINUTES: "45" })).toBe(45);
    expect(idleReleaseMinutes({ DEVHUB_PASEO_IDLE_RELEASE_MINUTES: "soon" })).toBe(15);
  });
});

describe("agentRuntimeIsReleasable", () => {
  const cutoff = NOW - 15 * 60_000;
  it("releases an idle chat untouched since the cutoff", () => {
    expect(agentRuntimeIsReleasable(agent("a") as never, cutoff)).toBe(true);
  });
  it.each([
    ["running", { status: "running" }],
    ["initializing", { status: "initializing" }],
    ["closed (holds no runtime)", { status: "closed" }],
    ["archived", { archivedAt: minutesAgo(30) }],
    ["waiting on a permission", { pendingPermissions: [{ id: "p" }] }],
    ["needing attention", { requiresAttention: true }],
    ["recently updated", { updatedAt: minutesAgo(5) }],
    ["recently messaged", { lastUserMessageAt: minutesAgo(5) }],
    ["of unknown age", { updatedAt: "", lastUserMessageAt: null }],
  ])("keeps a chat that is %s", (_label, extra) => {
    expect(agentRuntimeIsReleasable(agent("a", extra) as never, cutoff)).toBe(false);
  });
});

describe("releaseIdlePaseoRuntimes", () => {
  it("archives idle chats DevHub started and nothing else", async () => {
    listing(agent("mine"), agent("users-own-chat"), agent("mine-busy", { status: "running" }));
    await expect(release([run("mine"), run("mine-busy", { state: "running", finishedAt: undefined })])).resolves.toEqual({ released: ["mine"] });
    expect(daemon.archiveAgent).toHaveBeenCalledTimes(1);
    expect(daemon.archiveAgent).toHaveBeenCalledWith("mine");
  });

  it("leaves a chat whose DevHub run is active or finished within the grace period", async () => {
    listing(agent("active"), agent("just-finished"));
    await release([run("active", { state: "running", finishedAt: undefined }), run("just-finished", { finishedAt: NOW - 60_000 })]);
    expect(daemon.archiveAgent).not.toHaveBeenCalled();
  });

  it("uses the newest run when a chat has several", async () => {
    listing(agent("chat"));
    await release([run("chat"), run("chat", { state: "running", finishedAt: undefined })]);
    expect(daemon.archiveAgent).not.toHaveBeenCalled();
  });

  it("ignores runs from another Paseo connection and other runtimes", async () => {
    listing(agent("elsewhere"), agent("aionui"));
    await release([run("elsewhere", { connectionId: "ws://127.0.0.1:9999/" }), run("aionui", {}, "aionui")]);
    expect(daemon.fetchAgents).not.toHaveBeenCalled();
    expect(daemon.archiveAgent).not.toHaveBeenCalled();
  });

  it("re-checks the chat right before archiving", async () => {
    listing(agent("chat"));
    daemon.fetchAgent.mockResolvedValueOnce({ agent: agent("chat", { status: "running" }) });
    await expect(release([run("chat")])).resolves.toEqual({ released: [] });
    expect(daemon.archiveAgent).not.toHaveBeenCalled();
  });

  it("keeps going when one archive fails", async () => {
    listing(agent("a"), agent("b"));
    daemon.archiveAgent.mockRejectedValueOnce(new Error("busy"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(release([run("a"), run("b")])).resolves.toEqual({ released: ["b"] });
  });

  it("does nothing when turned off", async () => {
    listing(agent("mine"));
    await expect(release([run("mine")], { DEVHUB_PASEO_IDLE_RELEASE_MINUTES: "0" })).resolves.toEqual({ released: [] });
    expect(daemon.fetchAgents).not.toHaveBeenCalled();
  });
});
