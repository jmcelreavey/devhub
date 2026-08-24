import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listTags, lookupTag, renameTag, TAG_TOKEN_RE } from "./index";
import { clearIndex } from "@/lib/recall/store";

const saved: Record<string, string | undefined> = {};
let tmp: string;

function writeNote(relPath: string, paragraphs: string[]): void {
  const file = path.join(tmp, "notes", `${relPath}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const blocks = paragraphs.map((text) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  }));
  fs.writeFileSync(file, JSON.stringify(blocks));
}

function writeTasks(date: string, texts: string[]): void {
  const dir = path.join(tmp, "tasks");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${date}.json`),
    JSON.stringify(
      texts.map((text, i) => ({ id: `t${i}`, text, done: false, createdAt: `${date}T09:00:00Z` })),
    ),
  );
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tags-"));
  for (const key of ["NOTES_DIR", "TASKS_DIR", "DOCS_DIR", "REPO_ROOT"]) saved[key] = process.env[key];
  process.env.NOTES_DIR = path.join(tmp, "notes");
  process.env.TASKS_DIR = path.join(tmp, "tasks");
  process.env.DOCS_DIR = path.join(tmp, "docs");
  process.env.REPO_ROOT = tmp;
  clearIndex();
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  clearIndex();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("TAG_TOKEN_RE", () => {
  it("accepts the same shape the extractor emits", () => {
    expect(TAG_TOKEN_RE.test("auth")).toBe(true);
    expect(TAG_TOKEN_RE.test("_priv")).toBe(true);
    expect(TAG_TOKEN_RE.test("1abc")).toBe(false);
    expect(TAG_TOKEN_RE.test("UPPER")).toBe(false);
    expect(TAG_TOKEN_RE.test("a".repeat(33))).toBe(false);
  });
});

describe("listTags", () => {
  it("counts task tags live without an index", () => {
    writeTasks("2026-08-20", ["fix login #auth", "add sso #auth #sso"]);
    const tags = listTags();
    expect(tags[0]).toEqual({ id: "auth", count: 2 });
    expect(tags.map((t) => t.id)).toContain("sso");
  });

  it("filters by substring", () => {
    writeTasks("2026-08-20", ["x #authentication"]);
    expect(listTags("auth").map((t) => t.id)).toEqual(["authentication"]);
    expect(listTags("zzz")).toHaveLength(0);
  });
});

describe("lookupTag", () => {
  it("returns matching tasks and index-derived notes", () => {
    writeTasks("2026-08-20", ["ship #devhub thing"]);
    // The tag lives only in a second paragraph so lexical ranking can't win by accident.
    writeNote("learnings/devhub/notes", [
      "Completely unrelated prose about pipelines and queues.",
      "Mentioning #devhub here ties this note to the tag.",
    ]);
    const lookup = lookupTag("devhub");
    expect(lookup.tasks).toHaveLength(1);
    expect(lookup.tasks[0]?.text).toContain("#devhub");
    expect(lookup.notes.some((n) => n.href.includes("learnings/devhub/notes"))).toBe(true);
  });

  it("returns empty groups for an unknown tag", () => {
    writeTasks("2026-08-20", ["no tags here"]);
    const lookup = lookupTag("ghost");
    expect(lookup.tasks).toHaveLength(0);
    expect(lookup.notes).toHaveLength(0);
    expect(lookup.related).toHaveLength(0);
  });
});

describe("renameTag", () => {
  it("rewrites task texts and note blocks with boundary safety", async () => {
    writeTasks("2026-08-20", ["fix login #auth", "#auth-old followup stays"]);
    writeNote("notes/tagged", ["the #auth tag and #auth2 must behave"]);

    const result = await renameTag("auth", "identity");
    // task "#auth" + note "#auth" — "#auth-old" and "#auth2" are different tags.
    expect(result.replacements).toBe(2);
    expect(result.filesChanged).toBe(2);

    const tasks = JSON.parse(
      fs.readFileSync(path.join(tmp, "tasks", "2026-08-20.json"), "utf8"),
    ) as Array<{ text: string }>;
    expect(tasks[0]?.text).toBe("fix login #identity");
    expect(tasks[1]?.text).toBe("#auth-old followup stays");

    const note = JSON.parse(
      fs.readFileSync(path.join(tmp, "notes", "notes", "tagged.json"), "utf8"),
    ) as Array<{ content: Array<{ text?: string }> }>;
    expect(note[0]?.content[0]?.text).toBe("the #identity tag and #auth2 must behave");
  });

  it("rejects malformed tokens and no-ops on identity rename", async () => {
    writeTasks("2026-08-20", ["#keep"]);
    await expect(renameTag("Bad Tag", "ok")).rejects.toThrow();
    await expect(renameTag("ok", "")).rejects.toThrow();
    const result = await renameTag("keep", "keep");
    expect(result.replacements).toBe(0);
    const raw = fs.readFileSync(path.join(tmp, "tasks", "2026-08-20.json"), "utf8");
    expect(raw).toContain("#keep");
  });
});
