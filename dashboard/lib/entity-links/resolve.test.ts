import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveEntityLinks } from "./resolve";

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
});
