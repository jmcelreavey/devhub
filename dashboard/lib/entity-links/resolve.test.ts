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
    expect(result.related.some((r) => r.kind === "pr")).toBe(true);
  });
});
