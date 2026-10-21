import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NotesStorage } from "../storage.ts";
import { TasksStorage } from "../task-diagram-storage.ts";
import type { Context } from "../context.ts";
import { blocksToText, textToBlocks } from "../convert.ts";
import { registerTasksTools } from "./tasks.ts";
import { extractTaskNoteMetaFromMarkdown } from "../../../../shared/task-note/meta.ts";
import { registerNotesTools } from "./notes.ts";

const DAY = "2026-08-25";
const TASK_ID = "11111111-1111-4111-8111-111111111111";

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-tasks-sync-"));
  const tasksDir = path.join(root, "tasks");
  const notesDir = path.join(root, "notes");
  fs.mkdirSync(tasksDir);
  fs.mkdirSync(notesDir);

  fs.writeFileSync(
    path.join(tasksDir, `${DAY}.json`),
    JSON.stringify([
      {
        id: TASK_ID,
        text: "Do the thing #existing",
        done: false,
        createdAt: "2026-08-25T10:00:00.000Z",
        links: [{ kind: "note", id: "projects/plan", label: "Plan" }],
      },
    ]),
  );

  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  const server = {
    registerTool: (
      name: string,
      _config: unknown,
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ) => handlers.set(name, handler),
  } as unknown as McpServer;

  const ctx = {
    tasksStorage: new TasksStorage(tasksDir),
    storage: new NotesStorage(notesDir),
  } as unknown as Context;
  registerTasksTools(server, ctx);
  registerNotesTools(server, ctx);
  return { handlers, ctx, tasksDir, notesDir, root };
}

let env: ReturnType<typeof setup>;
beforeEach(() => {
  env = setup();
});
afterEach(() => {
  fs.rmSync(env.root, { recursive: true, force: true });
});

const syncArgs = {
  id: TASK_ID,
  date: DAY,
  links: [
    { kind: "pr", id: "owner/repo#9", label: "PR #9", href: "https://github.com/owner/repo/pull/9" },
  ],
  noteSummary: "Implemented the thing.",
  noteSummaryKey: "https://github.com/owner/repo/pull/9",
};

async function call(args: Record<string, unknown>) {
  const result = (await env.handlers.get("tasks_context_sync")(args)) as { content: { text: string }[] };
  return result.content[0].text;
}

function noteMarkdown() {
  const note = env.ctx.storage.read("task-notes/2026-08-25-11111111-1111-4111-8111-111111111111");
  return blocksToText(note!.content as unknown[]);
}

describe("tasks_context_sync", () => {
  it("never infers PTF-4891 as a child task's Jira key from a parent prefix or context link", async () => {
    await env.handlers.get("tasks_create")!({ text: "PTF-4891 Android login", date: DAY, parentKey: "PTF-4891", withNote: true, links: [{ kind: "jira", id: "PTF-4891", label: "Parent PTF-4891" }] });
    const task = env.ctx.tasksStorage.getDay(DAY).tasks.find((item) => item.text === "Android login")!;
    expect(task).toMatchObject({ parentKey: "PTF-4891", text: "Android login" });
    expect(task.jiraKey).toBeUndefined();
    expect(task.links).toContainEqual({ kind: "jira", id: "PTF-4891", label: "Parent PTF-4891" });
    await env.handlers.get("tasks_update")!({ id: task.id, date: DAY, text: "Android login (parent PTF-4891)" });
    expect(env.ctx.tasksStorage.getDay(DAY).tasks.find((item) => item.id === task.id)?.jiraKey).toBeUndefined();
  });
  it("opens and updates the inherited plan through both MCP note entry points", async () => {
    const previousDate = "2026-08-24";
    const previousId = "22222222-2222-4222-8222-222222222222";
    const notePath = `task-notes/${previousDate}-${previousId}`;
    const previous = { id: previousId, text: "Do the thing", done: false, createdAt: previousDate };
    fs.writeFileSync(path.join(env.tasksDir, `${previousDate}.json`), JSON.stringify([previous]));
    fs.writeFileSync(path.join(env.tasksDir, `${DAY}.json`), JSON.stringify([{
      ...previous, id: TASK_ID, rolledFromId: previousId, rolledFromDate: previousDate,
    }]));
    env.ctx.storage.write(notePath, textToBlocks("## Plan\n\nKeep the original plan."));
    const original = fs.readFileSync(path.join(env.notesDir, `${notePath}.json`), "utf8");
    const result = await env.handlers.get("notes_create_task")!({ id: TASK_ID, text: previous.text, date: DAY });
    expect(JSON.stringify(result)).toContain(`Already exists: ${notePath}`);
    expect(fs.readFileSync(path.join(env.notesDir, `${notePath}.json`), "utf8")).toBe(original);

    await call({ id: TASK_ID, date: DAY, noteSummary: "Implementation update.", noteSummaryKey: "carryover" });
    const markdown = blocksToText(env.ctx.storage.read(notePath)!.content as unknown[]);
    expect(markdown).toContain("Keep the original plan.");
    expect(markdown).toContain("Implementation update.");
    expect(env.ctx.tasksStorage.getDay(DAY).tasks[0]!.notePath).toBe(notePath);
    expect(fs.existsSync(path.join(env.notesDir, `task-notes/${DAY}-${TASK_ID}.json`))).toBe(false);
  });

  it("merges links, note links, and keyed summary", async () => {
    const out = await call(syncArgs);

    expect(out).toContain("links: +1 added");
    expect(out).toContain("note task-notes/2026-08-25-11111111-1111-4111-8111-111111111111 created");
    expect(out).toContain("summary added");

    const task = env.ctx.tasksStorage.getDay(DAY).tasks[0];
    expect(task.text).toBe("Do the thing #existing");
    expect(task.links).toHaveLength(2);

    const markdown = noteMarkdown();
    expect(markdown).toContain("## Implementation https://github.com/owner/repo/pull/9");
    expect(markdown).not.toContain("Tags:");
    expect(markdown).not.toContain("## Links");
    const links = extractTaskNoteMetaFromMarkdown(markdown)?.links ?? [];
    expect(links).toContainEqual(expect.objectContaining({ kind: "pr", id: "owner/repo#9", href: "https://github.com/owner/repo/pull/9" }));
    expect(links).toContainEqual(expect.objectContaining({ kind: "note", label: "Plan" }));
  });

  it("is idempotent on rerun", async () => {
    await call(syncArgs);
    const out = await call(syncArgs);

    expect(out).toContain("summary already present");
    expect(out).not.toContain("links: +");

    const task = env.ctx.tasksStorage.getDay(DAY).tasks[0];
    expect(task.text).toBe("Do the thing #existing");
    expect(task.links).toHaveLength(2);
    expect(noteMarkdown().match(/## Implementation /g)).toHaveLength(1);
  });

  it("preserves hand-written links and rich blocks when appending context", async () => {
    const originalBlocks = [
      ...textToBlocks([
        "# Do the thing",
        "",
        "## Links",
        "",
        "**Note:** [Hand written](/notes/projects/hand-written)",
        "",
        "## Notes",
        "",
        "- hand written observation",
      ].join("\n")),
      { id: "rich-block", type: "image", props: { url: "assets/example.png" }, content: [] },
    ];
    const notePath = "task-notes/2026-08-25-11111111-1111-4111-8111-111111111111";
    env.ctx.storage.write(notePath, originalBlocks);

    await call(syncArgs);

    const markdown = noteMarkdown();
    expect(markdown).toContain("- hand written observation");
    // The old "## Links" list is folded into the header block, keeping the hand-written link.
    expect(markdown).not.toContain("## Links");
    const links = extractTaskNoteMetaFromMarkdown(markdown)?.links ?? [];
    expect(links).toContainEqual(expect.objectContaining({ kind: "note", id: "projects/hand-written", label: "Hand written" }));
    expect(links).toContainEqual(expect.objectContaining({ kind: "pr", id: "owner/repo#9" }));
    const updatedBlocks = env.ctx.storage.read(notePath)!.content as unknown[];
    // Content blocks are untouched, rich ones included.
    const bullet = originalBlocks.find((b) => JSON.stringify(b).includes("hand written observation"));
    expect(updatedBlocks).toContainEqual(bullet);
    expect(updatedBlocks).toContainEqual(originalBlocks[originalBlocks.length - 1]);
  });

  it("reports missing tasks", async () => {
    const out = await call({ id: "nope", date: DAY });
    expect(out).toContain("Task not found: nope");
  });

  it("requires a stable key for note summaries", async () => {
    const out = await call({ id: TASK_ID, date: DAY, noteSummary: "Implemented the thing." });
    expect(out).toContain("noteSummaryKey is required");
    expect(env.ctx.tasksStorage.getDay(DAY).tasks[0].text).toBe("Do the thing #existing");
  });
});

describe("tasks_history", () => {
  it("returns full task ids and text across all days when requested", async () => {
    const result = (await env.handlers.get("tasks_history")({ includeTasks: true })) as {
      content: { text: string }[];
    };

    expect(result.content[0].text).toContain(DAY);
    expect(result.content[0].text).toContain(TASK_ID);
    expect(result.content[0].text).toContain("Do the thing #existing");
  });
});

describe("tasks_update jira link promotion", () => {
  let env: ReturnType<typeof setup>;

  beforeEach(() => {
    env = setup();
  });
  afterEach(() => {
    fs.rmSync(env.root, { recursive: true, force: true });
  });

  it("promotes jiraKey when a jira hop is added without a title key", async () => {
    const result = (await env.handlers.get("tasks_update")!({
      id: TASK_ID,
      date: DAY,
      links: [
        { kind: "note", id: "projects/plan", label: "Plan" },
        {
          kind: "jira",
          id: "PTF-4783",
          label: "PTF-4783 — Acme comments count",
          href: "https://example.atlassian.net/browse/PTF-4783",
        },
      ],
    })) as { content: { text: string }[] };
    expect(result.content[0]?.text).toContain("Updated task");
    const task = env.ctx.tasksStorage.getDay(DAY).tasks[0]!;
    expect(task.jiraKey).toBe("PTF-4783");
    expect(task.text.startsWith("PTF-4783")).toBe(true);
  });
});


describe("tasks_history query", () => {
  async function history(args: Record<string, unknown>) {
    const result = (await env.handlers.get("tasks_history")!(args)) as { content: { text: string }[] };
    return result.content[0].text;
  }

  it("returns only matching tasks, with their date, across every day", async () => {
    fs.writeFileSync(
      path.join(env.tasksDir, "2026-08-20.json"),
      JSON.stringify([
        { id: "22222222-2222-4222-8222-222222222222", text: "Ship PTF-4801 fix", done: true, createdAt: "2026-08-20T09:00:00.000Z" },
        { id: "33333333-3333-4333-8333-333333333333", text: "Unrelated", done: false, createdAt: "2026-08-20T09:00:00.000Z" },
      ]),
    );
    const text = await history({ query: "ptf-4801" });
    expect(text).toContain("1 matching task(s)");
    expect(text).toContain("2026-08-20 [x] 22222222-2222-4222-8222-222222222222 - Ship PTF-4801 fix");
    expect(text).not.toContain("Unrelated");
  });

  it("says so when nothing matches", async () => {
    expect(await history({ query: "nope" })).toBe('No tasks matching "nope"');
  });

  it("returns the open task across the days it spans, and trims when days is passed", async () => {
    const full = await history({ includeTasks: true });
    expect(full).toContain(DAY);
    expect(full).toContain(TASK_ID);
    const trimmed = await history({ includeTasks: true, days: 1 });
    expect(trimmed).toContain("older day(s) not shown");
    expect(trimmed).not.toContain(DAY);
  });
});

describe("tasks_update completion readies draft PRs", () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => { env = setup(); });
  afterEach(() => { fs.rmSync(env.root, { recursive: true, force: true }); });

  function withDashboard(post: (path: string, body: unknown) => Promise<unknown>) {
    const calls: Array<{ path: string; body: unknown }> = [];
    (env.ctx as unknown as { dashboard: unknown }).dashboard = { post: async (p: string, body: unknown) => { calls.push({ path: p, body }); return post(p, body); } };
    return calls;
  }
  const update = (args: Record<string, unknown>) => env.handlers.get("tasks_update")!({ id: TASK_ID, date: DAY, ...args }) as Promise<{ content: { text: string }[] }>;

  it("asks the dashboard to ready the task's PRs and reports what changed", async () => {
    const calls = withDashboard(async () => ({ outcomes: [{ url: "https://github.com/acme/app/pull/7", result: "readied" }, { url: "https://github.com/acme/app/pull/8", result: "failed", detail: "HTTP 502" }] }));
    const text = (await update({ status: "complete" })).content[0]!.text;
    expect(calls).toEqual([{ path: "/api/tasks/ready-prs", body: { taskId: TASK_ID, reason: "task completed" } }]);
    expect(text).toMatch(/^Updated task:/m);
    expect(text).toContain("Marked ready for review: https://github.com/acme/app/pull/7.");
    expect(text).toContain("Couldn't mark ready (logged on the task note): https://github.com/acme/app/pull/8 (HTTP 502).");
  });

  it("says so when the dashboard can't be reached, and skips edits that don't complete", async () => {
    const calls = withDashboard(async () => { throw new Error("connect ECONNREFUSED"); });
    expect((await update({ text: "Renamed" })).content[0]!.text).not.toContain("draft PRs");
    expect(calls).toHaveLength(0);
    expect((await update({ done: true })).content[0]!.text).toContain("Couldn't check this task's draft PRs (is the dashboard running?): connect ECONNREFUSED");
  });
});
