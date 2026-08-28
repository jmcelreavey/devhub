import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveEntityContext, resolveEntityLinks } from "./resolve";

const originalNotes = process.env.NOTES_DIR;
const originalTasks = process.env.TASKS_DIR;

describe("resolveEntityLinks", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "entity-links-"));
    process.env.NOTES_DIR = path.join(root, "notes");
    process.env.TASKS_DIR = path.join(root, "tasks");
    fs.mkdirSync(path.join(root, "notes", "task-notes"), { recursive: true });
    fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  });

  afterEach(() => {
    if (originalNotes === undefined) delete process.env.NOTES_DIR;
    else process.env.NOTES_DIR = originalNotes;
    if (originalTasks === undefined) delete process.env.TASKS_DIR;
    else process.env.TASKS_DIR = originalTasks;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("finds a task note and task.links", () => {
    const date = "2026-07-28";
    const id = "abc-1";
    fs.writeFileSync(
      path.join(root, "tasks", `${date}.json`),
      JSON.stringify([
        {
          id,
          text: "Ship linking",
          done: false,
          createdAt: `${date}T10:00:00.000Z`,
          links: [
            {
              kind: "pr",
              id: "org/repo#9",
              label: "org/repo#9",
              href: "https://github.com/org/repo/pull/9",
            },
          ],
        },
      ]),
    );
    fs.writeFileSync(
      path.join(root, "notes", "task-notes", `${date}-${id}.json`),
      JSON.stringify({
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "## Links" }],
          },
        ],
      }),
    );

    const result = resolveEntityLinks("task", id, { date, label: "Ship linking" });
    expect(result.notes.some((n) => n.id.includes(id))).toBe(true);
    expect(result.notes.find((n) => n.id.includes(id))?.label).toBe("Note");
    expect(result.related.some((r) => r.kind === "pr")).toBe(true);
  });

  it("does not auto-emit the task's own jiraKey as a related chip", () => {
    const date = "2026-07-28";
    const id = "abc-2";
    fs.writeFileSync(
      path.join(root, "tasks", `${date}.json`),
      JSON.stringify([
        {
          id,
          text: "PTF-99 Do the thing",
          done: false,
          jiraKey: "PTF-99",
          createdAt: `${date}T10:00:00.000Z`,
          links: [
            { kind: "jira", id: "PTF-99", label: "PTF-99" },
            { kind: "jira", id: "PTF-100", label: "PTF-100" },
          ],
        },
      ]),
    );

    const result = resolveEntityLinks("task", id, { date });
    expect(result.related.some((r) => r.kind === "jira" && r.id === "PTF-99")).toBe(false);
    expect(result.related.some((r) => r.kind === "jira" && r.id === "PTF-100")).toBe(true);
  });

  it("surfaces inline #tags from a note body as related refs", () => {
    fs.mkdirSync(path.join(root, "notes", "learnings"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "notes", "learnings", "tagged.json"),
      JSON.stringify({
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Cache notes #devhub and #perf live here." }],
          },
        ],
      }),
    );

    const result = resolveEntityLinks("note", "learnings/tagged");
    const tags = result.related.filter((r) => r.kind === "tag");
    expect(tags.map((t) => t.id)).toEqual(["devhub", "perf"]);
    expect(tags[0]?.href).toBe("/work?tag=devhub");
  });

  it("reads a note stored as a bare block array (the actual on-disk shape)", () => {
    fs.mkdirSync(path.join(root, "notes", "learnings"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "notes", "learnings", "bare.json"),
      JSON.stringify([
        {
          type: "paragraph",
          content: [{ type: "text", text: "Bare array notes tag #devhub too." }],
        },
      ]),
    );

    const result = resolveEntityLinks("note", "learnings/bare");
    expect(result.related.map((r) => r.id)).toContain("devhub");
  });

  it("doesn't double up a linking task across a rollover (stale copy left behind + fresh id today)", () => {
    fs.writeFileSync(
      path.join(root, "tasks", "2026-08-25.json"),
      JSON.stringify([
        {
          id: "yesterday-id",
          text: "Chase PTF-4791",
          done: false,
          createdAt: "2026-08-25T10:00:00.000Z",
          jiraKey: "PTF-4791",
          movedAt: "2026-08-26T00:00:37.174Z",
          movedToDate: "2026-08-26",
        },
      ]),
    );
    fs.writeFileSync(
      path.join(root, "tasks", "2026-08-26.json"),
      JSON.stringify([
        {
          id: "today-id",
          text: "Chase PTF-4791",
          done: false,
          createdAt: "2026-08-26T00:00:37.174Z",
          jiraKey: "PTF-4791",
          rolledFromId: "yesterday-id",
          rolledFromDate: "2026-08-25",
        },
      ]),
    );

    const result = resolveEntityLinks("jira", "PTF-4791");
    const linkingTasks = result.related.filter((r) => r.kind === "task");
    expect(linkingTasks).toHaveLength(1);
    expect(linkingTasks[0]?.id).toBe("today-id");
  });

  it("finds the tickets/KEY companion note for a Jira entity", () => {
    fs.mkdirSync(path.join(root, "notes", "tickets"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "notes", "tickets", "PTF-1.json"),
      JSON.stringify([{ type: "paragraph", content: [{ type: "text", text: "Ticket note" }] }]),
    );

    const result = resolveEntityLinks("jira", "PTF-1");
    expect(result.notes.some((note) => note.id === "tickets/PTF-1")).toBe(true);
  });

  describe("two-way task links", () => {
    const writeDay = (date: string, tasks: unknown[]) =>
      fs.writeFileSync(path.join(root, "tasks", `${date}.json`), JSON.stringify(tasks));

    it("shows a back-link on the task that was linked to", () => {
      writeDay("2026-08-28", [
        { id: "pr5", text: "PR 5: Bookmark backend", done: false, createdAt: "2026-08-28T06:00:00.000Z" },
        {
          id: "pr6",
          text: "PR 6: Bookmark API",
          done: false,
          createdAt: "2026-08-28T06:00:00.000Z",
          links: [{ kind: "task", id: "pr5", label: "PR 5: Bookmark backend", href: "/work?tab=tasks" }],
        },
      ]);

      const back = resolveEntityLinks("task", "pr5", { date: "2026-08-28" });
      expect(back.related.filter((r) => r.kind === "task").map((r) => r.id)).toEqual(["pr6"]);

      // The side that owns the edge still shows it, pointed at the right day.
      const forward = resolveEntityLinks("task", "pr6", { date: "2026-08-28" });
      const pr5 = forward.related.find((r) => r.kind === "task");
      expect(pr5?.id).toBe("pr5");
      expect(pr5?.href).toBe("/work?date=2026-08-28");
    });

    it("survives rollover: a link naming yesterday's uuid resolves to today's copy", () => {
      writeDay("2026-08-27", [
        {
          id: "pr5-day1",
          text: "PR 5: Bookmark backend",
          done: false,
          createdAt: "2026-08-27T06:00:00.000Z",
          movedAt: "2026-08-28T00:00:00.000Z",
          movedToDate: "2026-08-28",
        },
      ]);
      writeDay("2026-08-28", [
        {
          id: "pr5-day2",
          text: "PR 5: Bookmark backend",
          done: false,
          createdAt: "2026-08-28T00:00:00.000Z",
          rolledFromId: "pr5-day1",
          rolledFromDate: "2026-08-27",
        },
        {
          id: "pr6",
          text: "PR 6: Bookmark API",
          done: false,
          createdAt: "2026-08-28T00:00:00.000Z",
          // Stored yesterday, so it still names yesterday's uuid.
          links: [{ kind: "task", id: "pr5-day1", label: "PR 5: Bookmark backend" }],
        },
      ]);

      // Reverse: today's PR 5 still knows PR 6 points at it.
      const back = resolveEntityLinks("task", "pr5-day2", { date: "2026-08-28" });
      expect(back.related.filter((r) => r.kind === "task").map((r) => r.id)).toEqual(["pr6"]);

      // Outbound: the stale ref is re-pointed at the live copy.
      const forward = resolveEntityLinks("task", "pr6", { date: "2026-08-28" });
      const pr5 = forward.related.find((r) => r.kind === "task");
      expect(pr5?.id).toBe("pr5-day2");
      expect(pr5?.href).toBe("/work?date=2026-08-28");
    });

    it("never lists any id in its own lineage as related", () => {
      writeDay("2026-08-27", [
        {
          id: "a-day1",
          text: "Self",
          done: false,
          createdAt: "2026-08-27T06:00:00.000Z",
          movedAt: "2026-08-28T00:00:00.000Z",
          movedToDate: "2026-08-28",
          links: [{ kind: "task", id: "a-day1", label: "Self" }],
        },
      ]);
      writeDay("2026-08-28", [
        {
          id: "a-day2",
          text: "Self",
          done: false,
          createdAt: "2026-08-28T00:00:00.000Z",
          rolledFromId: "a-day1",
          rolledFromDate: "2026-08-27",
          links: [{ kind: "task", id: "a-day1", label: "Self" }],
        },
      ]);

      const result = resolveEntityLinks("task", "a-day2", { date: "2026-08-28" });
      expect(result.related.filter((r) => r.kind === "task")).toEqual([]);
    });
  });

  describe("resolveEntityContext depth 2", () => {
    const seedChain = () => {
      fs.mkdirSync(path.join(root, "notes", "projects"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "notes", "projects", "webview-plan.json"),
        JSON.stringify([
          { type: "paragraph", content: [{ type: "text", text: "## Links" }] },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "**Jira:** [PTF-4785](https://x.atlassian.net/browse/PTF-4785)",
              },
            ],
          },
        ]),
      );
      fs.writeFileSync(
        path.join(root, "tasks", "2026-08-28.json"),
        JSON.stringify([
          {
            id: "pr6",
            text: "PR 6: Bookmark API",
            done: false,
            createdAt: "2026-08-28T06:00:00.000Z",
            links: [{ kind: "task", id: "pr5", label: "PR 5" }],
          },
          {
            id: "pr5",
            text: "PR 5: Bookmark backend",
            done: false,
            createdAt: "2026-08-28T06:00:00.000Z",
            links: [{ kind: "note", id: "projects/webview-plan", label: "WebView implementation plan" }],
          },
        ]),
      );
    };

    it("reaches a linked task's own note, which depth 1 does not", () => {
      seedChain();

      const shallow = resolveEntityContext("task", "pr6", { date: "2026-08-28" });
      expect(shallow.expanded).toEqual([]);
      expect(shallow.related.some((r) => r.id === "projects/webview-plan")).toBe(false);

      const deep = resolveEntityContext("task", "pr6", { date: "2026-08-28", depth: 2 });
      expect(deep.expanded.some((r) => r.id === "projects/webview-plan")).toBe(true);
      // Two hops, not three: this note is reached VIA pr5, so its own ## Links
      // sit at depth 3 and stay out.
      expect(deep.expanded.some((r) => r.kind === "jira" && r.id === "PTF-4785")).toBe(false);
      // Directly linked, though, and the note body is read one hop out.
      const fromPr5 = resolveEntityContext("task", "pr5", { date: "2026-08-28", depth: 2 });
      expect(fromPr5.expanded.some((r) => r.kind === "jira" && r.id === "PTF-4785")).toBe(true);
      // depth 1 stays exactly what it was.
      expect(deep.related).toEqual(shallow.related);
    });

    it("does not expand repo or tag refs — that is a listing, not context", () => {
      fs.writeFileSync(
        path.join(root, "tasks", "2026-08-28.json"),
        JSON.stringify([
          {
            id: "target",
            text: "Do a thing #shared",
            done: false,
            createdAt: "2026-08-28T06:00:00.000Z",
            links: [{ kind: "repo", id: "app-poc", label: "app-poc" }],
          },
          {
            id: "unrelated",
            text: "Some other repo work #shared",
            done: false,
            createdAt: "2026-08-28T06:00:00.000Z",
            links: [{ kind: "repo", id: "app-poc", label: "app-poc" }],
          },
        ]),
      );

      const deep = resolveEntityContext("task", "target", { date: "2026-08-28", depth: 2 });
      expect(deep.related.some((r) => r.kind === "repo")).toBe(true);
      expect(deep.expanded.some((r) => r.id === "unrelated")).toBe(false);
    });

    it("caps expanded refs", () => {
      const many = Array.from({ length: 12 }, (_, i) => ({
        id: `t${i}`,
        text: `Task ${i}`,
        done: false,
        createdAt: "2026-08-28T06:00:00.000Z",
        links: [{ kind: "task", id: "hub", label: "Hub" }],
      }));
      fs.writeFileSync(
        path.join(root, "tasks", "2026-08-28.json"),
        JSON.stringify([
          { id: "hub", text: "Hub", done: false, createdAt: "2026-08-28T06:00:00.000Z" },
          ...many,
        ]),
      );

      const deep = resolveEntityContext("task", "hub", { date: "2026-08-28", depth: 2, maxRefs: 3 });
      expect(deep.expanded.length).toBeLessThanOrEqual(3);
    });
  });
});
