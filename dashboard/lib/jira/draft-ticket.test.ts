import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateAiText } from "@/lib/ai/generate";
import { resolveEntityContext } from "@/lib/entity-links/resolve";
import { resolveSkillForRead } from "@/lib/skill-catalog";
import { readTaskNoteMarkdown } from "@/lib/tasks/implement-ready-gather";
import type { Task } from "@/lib/tasks/types";
import { getTicketWithDescription } from "./client";
import type { DraftEvent } from "./draft-events";
import { draftJiraTicket } from "./draft-ticket";

vi.mock("@/lib/ai/generate", () => ({ generateAiText: vi.fn() }));
vi.mock("@/lib/ai/writing-voice", () => ({ getWritingVoicePrompt: () => "British technical voice in full-voice mode" }));
vi.mock("@/lib/desktop/runtime-paths", () => ({ getResourceRoot: () => "/repo" }));
vi.mock("@/lib/entity-links/resolve", () => ({ resolveEntityContext: vi.fn() }));
vi.mock("@/lib/skill-catalog", () => ({ resolveSkillForRead: vi.fn() }));
vi.mock("@/lib/tasks/implement-ready-gather", () => ({
  readTaskNoteMarkdown: vi.fn(),
  resolveTaskNotePath: () => "task-notes/renewals",
}));
vi.mock("./client", () => ({ getTicketWithDescription: vi.fn() }));

const task: Task = {
  id: "task-1", text: "TEST-7 Fix renewal events", jiraKey: "TEST-7",
  done: false, createdAt: "2026-10-01T12:00:00Z", startDate: "2026-10-01", rank: "1",
  links: [{ kind: "note", id: "reference/renewals", label: "Renewal behaviour" }],
};
const draft = { summary: "Handle renewal events in order", description: "Renewal events can arrive out of order.\n\n- Keep the most recent subscription state." };
const markdown: Record<string, string> = {
  "task-notes/renewals": "# Plan\nKeep event IDs for deduplication.",
  "reference/renewals": "# Reference\nEvents carry a timestamp.",
  "discovery/event-order": "# Investigation\nOlder events must not undo a later update.",
};

function stepTrace(events: DraftEvent[]): string[] {
  return events.filter((event) => event.type === "step").map((event) => `${event.step}:${event.status}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.mocked(resolveSkillForRead).mockReturnValue({
    file: fileURLToPath(new URL("../../../skills/shared/devhub-draft-jira-ticket/SKILL.md", import.meta.url)),
    dir: "/skill", source: "devhub", readOnly: false,
  });
  vi.mocked(resolveEntityContext).mockReturnValue({
    entity: { kind: "task", id: task.id, label: task.text },
    notes: [{ kind: "note", id: "task-notes/renewals", label: "Plan" }],
    related: [{ kind: "jira", id: "TEST-7", label: "TEST-7" }],
    expanded: [{ kind: "note", id: "discovery/event-order", label: "Investigation" }],
  });
  vi.mocked(readTaskNoteMarkdown).mockImplementation((path) => markdown[path] ?? null);
  vi.mocked(getTicketWithDescription).mockImplementation(async (key) => ({
    key, summary: "Subscription renewal", status: { name: "Open" }, issuetype: "Task",
    description: "Keep valid subscriptions active.",
    parent: key === "TEST-7" ? { key: "TEST-1", summary: "Subscription reliability" } : null,
  }));
  vi.mocked(generateAiText).mockResolvedValue({ text: JSON.stringify(draft), provider: "api" });
});

describe("draftJiraTicket", () => {
  it("uses the task, linked and nearby notes, Jira parent descriptions, skill and developer voice", async () => {
    const controller = new AbortController();
    await expect(draftJiraTicket(task, "2026-10-01", controller.signal)).resolves.toEqual({ ...draft, warnings: [] });
    const options = vi.mocked(generateAiText).mock.calls[0]![0];
    const source = JSON.parse(options.prompt);
    expect(source.task.text).toBe(task.text);
    expect(source.notes).toEqual(Object.entries(markdown).map(([path, markdown]) => ({ path, markdown })));
    expect(source.jira.map((ticket: { key: string }) => ticket.key)).toEqual(["TEST-7", "TEST-1"]);
    expect(source.jira[1].description).toBe("Keep valid subscriptions active.");
    expect(getTicketWithDescription).toHaveBeenCalledTimes(2);
    expect(getTicketWithDescription).toHaveBeenCalledWith("TEST-1", controller.signal);
    expect(options.system).toContain("# Draft Jira Ticket");
    expect(options.system).not.toContain("short-description:");
    expect(options.system).toContain("British technical voice in full-voice mode");
    expect(options.abortSignal).toBe(controller.signal);
    expect(options.prefer).toBeUndefined();
    expect(options.model).toBeUndefined();
    expect(task.text).toBe("TEST-7 Fix renewal events");
  });

  it("reports progress in order and streams the title and description as they are written", async () => {
    vi.mocked(generateAiText).mockImplementation(async (opts) => {
      opts.onTextDelta?.('{"summary":"Handle renewal');
      opts.onTextDelta?.(' events in order","description":"Keep state."}');
      return { text: JSON.stringify(draft), provider: "api" };
    });
    const events: DraftEvent[] = [];
    await draftJiraTicket(task, "2026-10-01", undefined, (event) => events.push(event));
    expect(stepTrace(events)).toEqual([
      "context:running",
      "jira:running",
      "context:done",
      "jira:done",
      "draft:running",
      "draft:done",
      "format:running",
      "format:done",
    ]);
    expect(events).toContainEqual({ type: "partial", summary: "Handle renewal", description: "" });
    expect(events).toContainEqual({ type: "partial", summary: "Handle renewal events in order", description: "Keep state." });
  });

  it("fetches known Jira tickets concurrently, then the parent once the linked ticket returns", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started: string[] = [];
    vi.mocked(getTicketWithDescription).mockImplementation(async (key) => {
      started.push(key);
      if (key === "TEST-7" || key === "TEST-9") await gate;
      return {
        key, summary: "Subscription renewal", status: { name: "Open" }, issuetype: "Task",
        description: "Keep valid subscriptions active.",
        parent: key === "TEST-7" ? { key: "TEST-1", summary: "Subscription reliability" } : null,
      };
    });
    const pending = draftJiraTicket({
      ...task,
      links: [...(task.links ?? []), { kind: "jira", id: "test-9", label: "Other" }],
    }, "2026-10-01");
    await vi.waitFor(() => expect(started).toEqual(expect.arrayContaining(["TEST-7", "TEST-9"])));
    expect(started).not.toContain("TEST-1");
    release();
    await pending;
    expect(started).toContain("TEST-1");
  });

  it("names the step that failed and leaves a cancelled draft unmarked", async () => {
    vi.mocked(generateAiText).mockRejectedValue(new Error("rate limited"));
    const failed: DraftEvent[] = [];
    await expect(draftJiraTicket(task, "2026-10-01", undefined, (event) => failed.push(event))).rejects.toThrow("rate limited");
    expect(failed.at(-1)).toMatchObject({ type: "step", step: "draft", status: "error" });

    const controller = new AbortController();
    vi.mocked(generateAiText).mockImplementation(async (opts) => {
      controller.abort();
      opts.abortSignal?.throwIfAborted();
      return { text: JSON.stringify(draft), provider: "api" };
    });
    const cancelled: DraftEvent[] = [];
    await expect(draftJiraTicket(task, "2026-10-01", controller.signal, (event) => cancelled.push(event))).rejects.toThrow();
    expect(cancelled.some((event) => event.type === "step" && event.status === "error")).toBe(false);
  });

  it("uses a draft-only provider and model when they are configured", async () => {
    vi.stubEnv("JIRA_DRAFT_PROVIDER", "not-a-provider");
    vi.stubEnv("JIRA_DRAFT_MODEL", "cursor-grok-4.6-low-fast");
    await draftJiraTicket(task, "2026-10-01");
    expect(vi.mocked(generateAiText).mock.calls[0]![0].model).toBe("cursor-grok-4.6-low-fast");
    expect(vi.mocked(generateAiText).mock.calls[0]![0].prefer).toBeUndefined();

    vi.stubEnv("JIRA_DRAFT_PROVIDER", "api");
    await draftJiraTicket(task, "2026-10-01");
    expect(vi.mocked(generateAiText).mock.calls[1]![0].prefer).toBe("api");
    expect(vi.mocked(generateAiText).mock.calls[1]![0].reasoningEffort).toBeUndefined();
  });

  it("passes a valid draft reasoning effort and ignores an unknown one", async () => {
    vi.stubEnv("JIRA_DRAFT_REASONING_EFFORT", "LOW");
    await draftJiraTicket(task, "2026-10-01");
    expect(vi.mocked(generateAiText).mock.calls[0]![0].reasoningEffort).toBe("low");

    vi.stubEnv("JIRA_DRAFT_REASONING_EFFORT", "fastest");
    await draftJiraTicket(task, "2026-10-01");
    expect(vi.mocked(generateAiText).mock.calls[1]![0].reasoningEffort).toBeUndefined();
  });

  it("reports missing sources while drafting from the remaining material", async () => {
    vi.mocked(readTaskNoteMarkdown).mockReturnValue(null);
    vi.mocked(getTicketWithDescription).mockRejectedValue(new Error("Offline"));
    const result = await draftJiraTicket(task, "2026-10-01");
    expect(result.summary).toBe(draft.summary);
    expect(result.warnings).toContain("Couldn't read linked note reference/renewals.");
    expect(result.warnings).toContain("Couldn't read Jira ticket TEST-7.");
  });

  it.each([
    "Not JSON",
    JSON.stringify({ ...draft, summary: "Title\nsecond line" }),
    JSON.stringify({ ...draft, summary: "x".repeat(256) }),
    JSON.stringify({ ...draft, description: "x".repeat(5_001) }),
    JSON.stringify({ ...draft, description: " " }),
    JSON.stringify({ ...draft, parentKey: "TEST-99" }),
  ])("rejects invalid output rather than presenting it for creation", async (text) => {
    vi.mocked(generateAiText).mockResolvedValue({ text, provider: "api" });
    await expect(draftJiraTicket(task, "2026-10-01")).rejects.toThrow("draft was invalid");
  });

  it("accepts a reply whose strings contain raw line breaks", async () => {
    vi.mocked(generateAiText).mockResolvedValue({
      text: '{"summary":"Handle renewal events in order","description":"Line one\nLine two"}',
      provider: "api",
    });
    await expect(draftJiraTicket(task, "2026-10-01")).resolves.toMatchObject({ description: "Line one\nLine two" });
  });

  it.each([
    { ...draft, summary: "Create a DevHub task" },
    { ...draft, description: "See DEVHUB for the implementation plan." },
    { ...draft, description: "[Plan](https://devhub.example/notes/plan)" },
  ])("rejects drafts mentioning DevHub", async (result) => {
    vi.mocked(generateAiText).mockResolvedValue({ text: JSON.stringify(result), provider: "api" });
    await expect(draftJiraTicket(task, "2026-10-01")).rejects.toThrow("mentioned DevHub");
  });

  it("accepts a fenced JSON answer without altering the drafted content", async () => {
    vi.mocked(generateAiText).mockResolvedValue({
      text: ["\x60\x60\x60json", JSON.stringify(draft), "\x60\x60\x60"].join("\n"), provider: "api",
    });
    await expect(draftJiraTicket(task, "2026-10-01")).resolves.toEqual({ ...draft, warnings: [] });
  });

  it("rejects oversized source material before contacting a model", async () => {
    vi.mocked(readTaskNoteMarkdown).mockReturnValue("x".repeat(100_001));
    await expect(draftJiraTicket(task, "2026-10-01")).rejects.toThrow("material is too large");
    expect(generateAiText).not.toHaveBeenCalled();
  });

  it("does no work for an already cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(draftJiraTicket(task, "2026-10-01", controller.signal)).rejects.toThrow();
    expect(resolveEntityContext).not.toHaveBeenCalled();
    expect(generateAiText).not.toHaveBeenCalled();
  });
});
