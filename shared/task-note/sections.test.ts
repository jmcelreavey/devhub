import { describe, expect, it } from "vitest";
import { blocksToText, textToBlocks } from "../markdown-convert/index.ts";
import { buildTaskNoteMarkdown } from "./index.ts";
import {
  TaskNoteOpError,
  applyTaskNoteOp,
  blockPlainText,
  inlinePlainText,
  joinTaskNote,
  migrateLegacyTaskNote,
  parseTaskNoteOp,
  readTaskNote,
  splitTaskNote,
  type NoteBlock,
  type TaskNoteOp,
} from "./sections.ts";
import { extractTaskNoteMetaFromMarkdown } from "./meta.ts";

const TASK_ID = "47fa0e13-97f5-4d41-9457-c5d149cb2b6f";
const NOW = new Date(2026, 9, 16, 14, 3);

const base = { textColor: "default", backgroundColor: "default", textAlignment: "left" };
const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });
const block = (type: string, content: unknown[], props: Record<string, unknown> = {}, children: unknown[] = []) => ({
  id: `b-${Math.random().toString(36).slice(2, 10)}`,
  type,
  props: { ...base, ...props },
  content,
  children,
});
const labelled = (label: string, rest: unknown[]) => block("paragraph", [text(label, { bold: true }), ...rest]);

/** The shape DevHub wrote before the metadata block: bullet-ish lines under "## Links". */
function legacyNote(): NoteBlock[] {
  const nested = block("bulletListItem", [text("Nested parent")], {}, [
    block("bulletListItem", [text("child detail", { code: true })]),
  ]);
  return [
    block("heading", [text("Version 17 app release prep")], { level: 1 }),
    labelled("Date:", [text(" 2026-10-07")]),
    block("heading", [text("Links")], { level: 2 }),
    { id: "ref-1", type: "taskRef", props: { taskId: TASK_ID, date: "2026-10-07", label: "Version 17 app release prep" }, children: [] },
    labelled("Task:", [text(" "), { type: "link", href: "/work?tab=tasks", styles: {}, content: [text("Open in Work")] }]),
    labelled("Repo:", [text(" app")]),
    block("heading", [text("Notes")], { level: 2 }),
    nested,
    block("bulletListItem", [text("keep "), text("this", { code: true }), text(" verbatim")]),
    block("heading", [text("Action items")], { level: 2 }),
    block("checkListItem", [text("ship it")], { checked: true }),
    block("heading", [text("Links")], { level: 2 }),
    labelled("PR:", [text(" app#170 — existing release workflows")]),
    labelled("Jira:", [text(" PTF-5195")]),
    block("heading", [text("Implementation https://github.com/example/app/pull/170")], { level: 2 }),
    block("paragraph", [text("Local implementation is ready.")]),
  ] as NoteBlock[];
}

const plain = (blocks: NoteBlock[]) => blocks.map((b) => blockPlainText(b));

describe("scaffold", () => {
  const md = buildTaskNoteMarkdown({
    id: TASK_ID,
    text: "Ship the thing #release",
    date: "2026-10-07",
    jiraKey: "PTF-1",
    jiraUrl: "https://example.atlassian.net/browse/PTF-1",
  });

  it("writes a metadata block instead of bullet lines", () => {
    expect(md).not.toContain("## Links");
    expect(md).not.toContain("**Date:**");
    const meta = extractTaskNoteMetaFromMarkdown(md);
    expect(meta?.status).toBe("todo");
    expect(meta?.tags).toEqual(["release"]);
    expect(meta?.links?.map((l) => l.kind)).toEqual(["jira", "task"]);
  });

  it("reads back through blocks with the free-form sections intact", () => {
    const view = readTaskNote(textToBlocks(md));
    expect(view.title).toBe("Ship the thing #release");
    expect(view.hasMeta).toBe(true);
    expect(view.taskRef?.taskId).toBe(TASK_ID);
    expect(view.freeformCount).toBeGreaterThan(0);
    expect(view.summary).toEqual([]);
  });
});

describe("migrateLegacyTaskNote", () => {
  it("folds Date, every Links section and the task backlink into the metadata block", () => {
    const original = legacyNote();
    const { blocks, changed } = migrateLegacyTaskNote(original);
    expect(changed).toBe(true);

    const view = readTaskNote(blocks);
    expect(view.title).toBe("Version 17 app release prep");
    expect(view.meta?.date).toBe("2026-10-07");
    expect(view.taskRef?.taskId).toBe(TASK_ID);
    const links = view.meta?.links ?? [];
    expect(links.map((l) => `${l.kind}:${l.label}`)).toEqual(
      expect.arrayContaining(["task:Open in Work", "repo:app", "pr:app#170 — existing release workflows", "jira:PTF-5195"]),
    );

    const texts = plain(blocks);
    expect(texts).not.toContain("Links");
    expect(texts.some((t) => t.startsWith("Date:"))).toBe(false);
    expect(texts.some((t) => t.startsWith("Repo:"))).toBe(false);
  });

  it("keeps free-form content byte-for-byte, nesting included", () => {
    const original = legacyNote();
    const { blocks } = migrateLegacyTaskNote(original);
    for (const b of original.filter((x) => ["Nested parent", "keep this verbatim", "ship it"].includes(blockPlainText(x)))) {
      expect(blocks).toContain(b);
    }
    const nested = blocks.find((b) => blockPlainText(b) === "Nested parent");
    expect(nested?.children).toHaveLength(1);
    expect(plain(blocks)).toEqual(expect.arrayContaining(["Notes", "Action items", "Local implementation is ready."]));
  });

  it("is idempotent", () => {
    const first = migrateLegacyTaskNote(legacyNote());
    const second = migrateLegacyTaskNote(first.blocks);
    expect(second.changed).toBe(false);
    expect(second.blocks).toBe(first.blocks);
  });

  it("leaves a note with nothing legacy exactly as it was", () => {
    const blocks = textToBlocks("# Plain\n\n## Notes\n\n- hello");
    const result = migrateLegacyTaskNote(blocks);
    expect(result.changed).toBe(false);
    expect(result.blocks).toBe(blocks);
  });

  it("keeps lines it cannot understand under their original heading", () => {
    const blocks = [
      block("heading", [text("Title")], { level: 1 }),
      block("heading", [text("Links")], { level: 2 }),
      labelled("Repo:", [text(" app")]),
      block("paragraph", [text("see the wiki for context")]),
    ] as NoteBlock[];
    const out = migrateLegacyTaskNote(blocks).blocks;
    expect(plain(out)).toEqual(expect.arrayContaining(["Links", "see the wiki for context"]));
    expect(readTaskNote(out).meta?.links?.map((l) => l.kind)).toEqual(["repo"]);
  });

  it("survives a markdown round trip with the migrated header", () => {
    const { blocks } = migrateLegacyTaskNote(legacyNote());
    const reread = readTaskNote(textToBlocks(blocksToText(blocks)));
    expect(reread.meta?.links?.length).toBe(readTaskNote(blocks).meta?.links?.length);
    expect(reread.taskRef?.taskId).toBe(TASK_ID);
  });
});

function run(blocks: NoteBlock[], op: TaskNoteOp) {
  return applyTaskNoteOp(blocks, op, { now: NOW });
}

function fresh(): NoteBlock[] {
  return textToBlocks(
    buildTaskNoteMarkdown({ id: TASK_ID, text: "Second stage", date: "2026-10-16" }),
  ) as NoteBlock[];
}

describe("applyTaskNoteOp", () => {
  it("sets the summary once and treats a repeat as a no-op", () => {
    const a = run(fresh(), { op: "set_summary", text: "Adds the vow room.\n\nOne UI overlap left." });
    expect(a.changed).toBe(true);
    expect(readTaskNote(a.blocks).summary).toHaveLength(2);
    const b = run(a.blocks, { op: "set_summary", text: "Adds the vow room.\n\nOne UI overlap left." });
    expect(b.changed).toBe(false);
    expect(b.blocks).toEqual(a.blocks);
  });

  it("never touches free-form blocks and orders sections canonically with Log last", () => {
    const start = fresh();
    const free = splitTaskNote(start).freeform;
    let blocks = run(start, { op: "append_log", message: "started" }).blocks;
    blocks = run(blocks, { op: "add_decision", title: "Tile layer", why: "cheaper" }).blocks;
    blocks = run(blocks, { op: "set_summary", text: "hello" }).blocks;
    const headings = blocks.filter((b) => b.type === "heading").map(blockPlainText);
    expect(headings).toEqual(["Second stage", "Summary", "Decisions", "Notes", "Log"]);
    for (const b of free) expect(blocks).toContain(b);
  });

  it("upserts decisions by title", () => {
    const a = run(fresh(), { op: "add_decision", title: "Hazards as a tile layer", why: "Cheaper collision.", alternatives: ["per-tile sprites"] });
    const view = readTaskNote(a.blocks);
    expect(view.decisions).toHaveLength(1);
    expect(view.decisions[0]?.title).toBe("Hazards as a tile layer.");
    const again = run(a.blocks, { op: "add_decision", title: "Hazards as a tile layer", why: "Cheaper collision.", alternatives: ["per-tile sprites"] });
    expect(again.changed).toBe(false);
    const edited = run(a.blocks, { op: "add_decision", title: "hazards as a tile layer", why: "Easier to telegraph." });
    expect(readTaskNote(edited.blocks).decisions).toHaveLength(1);
    expect(blockPlainText(edited.blocks.find((b) => blockPlainText(b).includes("telegraph"))!)).toContain("telegraph");
  });

  it("adds, answers and reopens questions", () => {
    let blocks = run(fresh(), { op: "add_question", text: "Vow room music?" }).blocks;
    expect(run(blocks, { op: "add_question", text: "vow room music?" }).changed).toBe(false);
    blocks = run(blocks, { op: "resolve_question", match: "music", answer: "Leave silent for now" }).blocks;
    let q = readTaskNote(blocks).questions[0]!;
    expect(q).toMatchObject({ text: "Vow room music?", answer: "Leave silent for now", resolved: true });
    expect(run(blocks, { op: "resolve_question", id: q.id, answer: "Leave silent for now" }).changed).toBe(false);
    blocks = run(blocks, { op: "resolve_question", id: q.id, reopen: true }).blocks;
    q = readTaskNote(blocks).questions[0]!;
    expect(q).toMatchObject({ text: "Vow room music?", resolved: false });
    expect(q.answer).toBeUndefined();
  });

  it("rejects an ambiguous or missing match", () => {
    let blocks = run(fresh(), { op: "add_question", text: "Music for room A?" }).blocks;
    blocks = run(blocks, { op: "add_question", text: "Music for room B?" }).blocks;
    expect(() => run(blocks, { op: "resolve_question", match: "music", answer: "x" })).toThrow(TaskNoteOpError);
    expect(() => run(blocks, { op: "resolve_question", match: "nothing here", answer: "x" })).toThrow(/No item matches/);
  });

  it("stores screenshots and video as media blocks with before/after captions", () => {
    let blocks = run(fresh(), { op: "add_media", assetPath: "task-notes/assets/a/before.png", caption: "Atrium", phase: "before" }).blocks;
    blocks = run(blocks, { op: "add_media", assetPath: "task-notes/assets/a/run.mp4", caption: "Full run", phase: "after" }).blocks;
    blocks = run(blocks, { op: "add_media", url: "https://ci.example.com/shot.png", caption: "CI" }).blocks;
    const media = readTaskNote(blocks).media;
    expect(media.map((m) => [m.kind, m.phase, m.caption])).toEqual([
      ["image", "before", "Atrium"],
      ["video", "after", "Full run"],
      ["image", undefined, "CI"],
    ]);
    expect(media[0]?.url).toBe("/api/notes-assets/task-notes/assets/a/before.png");
    expect(run(blocks, { op: "add_media", assetPath: "task-notes/assets/a/before.png", caption: "Atrium", phase: "before" }).changed).toBe(false);
    expect(() => run(blocks, { op: "add_media", url: "javascript:alert(1)" })).toThrow(TaskNoteOpError);
  });

  it("tracks bugs with severity and status", () => {
    let blocks = run(fresh(), { op: "add_bug", title: "Pause text overlap at 720p", severity: "low" }).blocks;
    blocks = run(blocks, { op: "add_bug", title: "Walk-through east wall", severity: "high", details: "player clips the tile" }).blocks;
    blocks = run(blocks, { op: "set_bug_status", match: "east wall", status: "fixed" }).blocks;
    const bugs = readTaskNote(blocks).bugs;
    expect(bugs).toEqual([
      expect.objectContaining({ status: "open", severity: "low", title: "Pause text overlap at 720p" }),
      expect.objectContaining({ status: "fixed", severity: "high", title: "Walk-through east wall", details: "player clips the tile" }),
    ]);
    expect(run(blocks, { op: "set_bug_status", match: "east wall", status: "fixed" }).changed).toBe(false);
  });

  it("keeps waypoints, points of interest and the log tidy", () => {
    let blocks = run(fresh(), { op: "add_waypoint", title: "Plan" }).blocks;
    blocks = run(blocks, { op: "add_waypoint", title: "Seal mini-boss", done: false }).blocks;
    blocks = run(blocks, { op: "add_waypoint", title: "seal mini-boss" }).blocks;
    blocks = run(blocks, { op: "add_poi", file: "src/boss/sealState.ts", note: "new state machine" }).blocks;
    blocks = run(blocks, { op: "append_log", message: "plan written" }).blocks;
    const dup = run(blocks, { op: "append_log", message: "plan written" });
    expect(dup.changed).toBe(false);
    blocks = run(blocks, { op: "append_log", message: "boss done" }).blocks;
    const view = readTaskNote(blocks);
    expect(view.waypoints.map((w) => [w.title, w.done])).toEqual([["Plan", true], ["Seal mini-boss", true]]);
    expect(view.poi[0]).toMatchObject({ file: "src/boss/sealState.ts" });
    expect(view.log.map((l) => l.message)).toEqual(["plan written", "boss done"]);
    expect(view.log[0]?.at).toBe("2026-10-16 14:03");
  });

  it("merges metadata and validates status", () => {
    let blocks = run(fresh(), { op: "set_status", status: "in-progress", text: "Step 3 of 5. Next: seal boss." }).blocks;
    blocks = run(blocks, { op: "set_meta", addModels: ["claude-opus-5-5"], addTags: ["Game"], addLinks: [{ kind: "pr", id: "o/r#212", label: "PR #212", href: "https://github.com/o/r/pull/212" }] }).blocks;
    blocks = run(blocks, { op: "set_meta", addModels: ["claude-opus-5-5", "claude-haiku-5-5"] }).blocks;
    const view = readTaskNote(blocks);
    expect(view.meta).toMatchObject({ status: "in-progress", models: ["claude-opus-5-5", "claude-haiku-5-5"], tags: ["game"] });
    expect(view.meta?.links?.map((l) => l.kind)).toContain("pr");
    expect(view.statusText).toHaveLength(1);
    expect(parseTaskNoteOp({ op: "set_status", status: "launched" })).toEqual({
      ok: false,
      error: expect.stringContaining("status must be one of"),
    });
  });

  it("marks deliberate status changes without marking a scaffold's default To do", () => {
    const scaffold = fresh();
    expect(readTaskNote(scaffold).meta?.statusSetAt).toBeUndefined();
    expect(readTaskNote(run(scaffold, { op: "set_meta" }).blocks).meta?.statusSetAt).toBeUndefined();
    const reset = run(scaffold, { op: "set_status", status: "todo" });
    expect(readTaskNote(reset.blocks).meta).toMatchObject({ status: "todo", statusSetAt: NOW.toISOString() });
    expect(run(reset.blocks, { op: "set_status", status: "todo" }).changed).toBe(false);
    const metadata = run(scaffold, { op: "set_meta", status: "todo" });
    expect(readTaskNote(metadata.blocks).meta?.statusSetAt).toBe(NOW.toISOString());
  });

  it("sets and clears a card's rank in task-meta only", () => {
    const before = fresh();
    let blocks = run(before, { op: "set_rank", rank: "i" }).blocks;
    expect(readTaskNote(blocks).meta?.rank).toBe("i");
    expect(readTaskNote(blocks).summary).toEqual(readTaskNote(before).summary);
    blocks = run(blocks, { op: "set_rank" }).blocks;
    expect(readTaskNote(blocks).meta?.rank).toBeUndefined();
    expect(parseTaskNoteOp({ op: "set_rank", rank: "I0" })).toEqual({ ok: false, error: expect.stringContaining("rank must be") });
  });

  it("removes and clears items without touching other sections", () => {
    let blocks = run(fresh(), { op: "add_poi", note: "risky area" }).blocks;
    blocks = run(blocks, { op: "add_decision", title: "Keep it", why: "yes" }).blocks;
    blocks = run(blocks, { op: "remove_item", section: "poi", match: "risky" }).blocks;
    expect(readTaskNote(blocks).poi).toEqual([]);
    expect(readTaskNote(blocks).decisions).toHaveLength(1);
    blocks = run(blocks, { op: "clear_section", section: "decisions" }).blocks;
    expect(readTaskNote(blocks).decisions).toEqual([]);
    expect(blocks.some((b) => blockPlainText(b) === "Decisions")).toBe(false);
  });

  it("migrates and edits a legacy note in one go", () => {
    const { blocks: migrated } = migrateLegacyTaskNote(legacyNote());
    const out = run(migrated, { op: "set_summary", text: "Staging release is configured." });
    expect(readTaskNote(out.blocks).summary).toHaveLength(1);
    expect(plain(out.blocks)).toContain("Local implementation is ready.");
  });

  it("refuses to overwrite a metadata block that is not valid JSON", () => {
    const broken = fresh().map((b) => (b.type === "codeBlock" ? { ...b, content: [text("{ nope")] } : b));
    expect(() => run(broken, { op: "set_meta", status: "done" })).toThrow(/not valid JSON/);
    const ok = run(broken, { op: "set_summary", text: "still works" });
    expect(readTaskNote(ok.blocks).summary).toHaveLength(1);
    expect(ok.blocks.find((b) => b.type === "codeBlock")).toBe(broken.find((b) => b.type === "codeBlock"));
  });

  it("round-trips every section through markdown", () => {
    let blocks = fresh();
    const ops: TaskNoteOp[] = [
      { op: "set_summary", text: "Short **summary**." },
      { op: "set_status", status: "needs-you", text: "Waiting on a PR review." },
      { op: "add_question", text: "Which room?" },
      { op: "resolve_question", match: "room", answer: "The flooded one" },
      { op: "add_decision", title: "Tile layer", why: "Cheaper.", alternatives: ["sprites"] },
      { op: "add_media", assetPath: "task-notes/assets/x/after.png", caption: "Vow room", phase: "after" },
      { op: "add_media", assetPath: "task-notes/assets/x/run.mp4", caption: "Run", phase: "before" },
      { op: "add_bug", title: "Overlap", severity: "low" },
      { op: "add_poi", file: "src/a.ts", note: "timing" },
      { op: "add_waypoint", title: "Plan" },
      { op: "append_log", message: "done" },
    ];
    for (const op of ops) blocks = run(blocks, op).blocks;
    const before = readTaskNote(blocks);
    const after = readTaskNote(textToBlocks(blocksToText(blocks)));
    // Adjacent text runs merge on re-parse, so compare inline content as text.
    const inlineKeys = new Set(["body", "note", "summary", "statusText"]);
    const strip = (v: ReturnType<typeof readTaskNote>) =>
      JSON.parse(
        JSON.stringify(v, (key, value) => {
          if (key === "id") return undefined;
          if (inlineKeys.has(key)) return Array.isArray(value[0]) ? value.map(inlinePlainText) : inlinePlainText(value);
          return value;
        }),
      );
    expect(strip(after)).toEqual(strip(before));
  });

  it("split/join keeps every block", () => {
    const blocks = legacyNote();
    const joined = joinTaskNote(splitTaskNote(blocks));
    expect(joined).toHaveLength(blocks.length);
  });
});

describe("parseTaskNoteOp", () => {
  it("accepts a valid operation and trims fields", () => {
    expect(parseTaskNoteOp({ op: "add_decision", title: "  Pick A  ", why: "faster" })).toEqual({
      ok: true,
      op: { op: "add_decision", title: "Pick A", why: "faster", alternatives: undefined },
    });
  });

  it.each([
    [{}, "op is required"],
    [{ op: "explode" }, "op must be one of"],
    [{ op: "add_decision" }, "title is required"],
    [{ op: "resolve_question", answer: "x" }, "id or match is required"],
    [{ op: "add_media" }, "url or assetPath is required"],
    [{ op: "add_bug", title: "x", severity: "scary" }, "severity must be one of"],
    [{ op: "remove_item", section: "freeform", match: "x" }, "section must be one of"],
    [{ op: "set_meta" }, "set_meta needs at least one"],
    [{ op: "add_question", text: 5 }, "text must be a string"],
  ])("rejects %j", (input, message) => {
    const result = parseTaskNoteOp(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });
});

describe("owner notes", () => {
  it.each(["remove_item", "clear_section"] as const)("protects Your notes from %s", (op) => {
    const blocks = run(fresh(), { op: "add_user_note", text: "Keep the existing retry behaviour." }).blocks;
    const before = JSON.stringify(blocks);
    expect(() => run(blocks, { op, section: "userNotes", match: "retry" })).toThrow("Your notes cannot be removed");
    expect(JSON.stringify(blocks)).toBe(before);
  });
});

describe("question options", () => {
  it("keeps all six options after a maximum-length question and through a markdown round trip", () => {
    const question = "q".repeat(600);
    const options = Array.from({ length: 6 }, (_, index) => `Choice ${index} ${"x".repeat(111)}`);
    const blocks = run(fresh(), { op: "add_question", text: question, options }).blocks;
    expect(readTaskNote(blocks).questions[0]).toMatchObject({ text: question, options });
    expect(readTaskNote(textToBlocks(blocksToText(blocks))).questions[0]).toMatchObject({ text: question, options });
  });

  it("normalizes pipes and whitespace, caps long options and removes duplicates before the limit", () => {
    const options = ["a|b", "a b", "  ", "two\nwords", "x".repeat(121), "x".repeat(120), "four", "five", "six", "seven"];
    const expected = ["a b", "two words", "x".repeat(120), "four", "five", "six"];
    const parsed = parseTaskNoteOp({ op: "add_question", text: "Which?", options });
    expect(parsed).toEqual({ ok: true, op: { op: "add_question", text: "Which?", options: expected } });
    expect(readTaskNote(run(fresh(), { op: "add_question", text: "Which?", options }).blocks).questions[0].options).toEqual(expected);
  });

  it("deduplicates retries with inline options and keeps answer Options: text intact", () => {
    const op = { op: "add_question", text: "Which env? Options: dev | prod | dev" } as const;
    const blocks = run(fresh(), op).blocks;
    expect(run(blocks, op).changed).toBe(false);
    expect(readTaskNote(blocks).questions[0].options).toEqual(["dev", "prod"]);
    const answered = run(blocks, { op: "resolve_question", match: "Which env?", answer: "Options: dev | prod" }).blocks;
    expect(readTaskNote(answered).questions[0]).toMatchObject({ text: "Which env?", options: ["dev", "prod"], answer: "Options: dev | prod", resolved: true });
  });

  it("preserves literal markdown and arrows in suggested answers", () => {
    const options = ["Use * as wildcard", "A → B"];
    expect(readTaskNote(run(fresh(), { op: "add_question", text: "Which?", options }).blocks).questions[0].options).toEqual(options);
  });

  it("stores options on the question line and reads them back without the suffix", () => {
    const view = readTaskNote(run(fresh(), { op: "add_question", text: "Which env?", options: ["dev", "prod"] }).blocks);
    expect(view.questions[0]).toMatchObject({ text: "Which env?", options: ["dev", "prod"], resolved: false });
    expect(parseTaskNoteOp({ op: "add_question", text: "Which env?", options: ["a|b", " "] })).toEqual({ ok: true, op: { op: "add_question", text: "Which env?", options: ["a b"] } });
  });
});

describe("bug resolutions", () => {
  it("records what was done when a bug is marked fixed, and keeps it when the status changes again", () => {
    let blocks = run(fresh(), { op: "add_bug", title: "History is discarded on reopen", details: "src/a.ts:48", severity: "high" }).blocks;
    blocks = run(blocks, { op: "set_bug_status", match: "History is discarded", status: "fixed", resolution: "Kept the WebView mounted and applied consent in place (src/a.ts)." }).blocks;
    const [bug] = readTaskNote(blocks).bugs;
    expect(bug).toMatchObject({ status: "fixed", severity: "high", title: "History is discarded on reopen", details: "src/a.ts:48", resolution: "Kept the WebView mounted and applied consent in place (src/a.ts)." });
    const reopened = readTaskNote(run(blocks, { op: "set_bug_status", match: "History is discarded", status: "open" }).blocks).bugs[0]!;
    expect(reopened.resolution).toContain("Kept the WebView mounted");
  });
});
