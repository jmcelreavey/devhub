import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getNoteIndex, invalidateNoteIndex } from "@/lib/notes/note-index";

const originalNotesDir = process.env.NOTES_DIR;
let root: string | null = null;

afterEach(() => {
  vi.useRealTimers();
  if (originalNotesDir === undefined) delete process.env.NOTES_DIR;
  else process.env.NOTES_DIR = originalNotesDir;
  invalidateNoteIndex();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = null;
});

const text = (value: string) => ({ type: "text", text: value, styles: {} });
const link = (href: string, label: string) => ({ type: "link", href, content: [text(label)] });
const heading = (value: string, level = 1) => ({
  type: "heading",
  props: { level },
  content: [text(value)],
  children: [],
});
const paragraph = (...content: unknown[]) => ({
  type: "paragraph",
  props: {},
  content: content.map((part) => (typeof part === "string" ? text(part) : part)),
  children: [],
});

function vault(files: Record<string, unknown>): void {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-note-index-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(content));
  }
  process.env.NOTES_DIR = root;
  invalidateNoteIndex();
}

function sectionsOf(areaId: string): Array<[string | null, string[]]> {
  const area = getNoteIndex().areas.find((group) => group.meta.id === areaId);
  return (area?.sections ?? []).map((section) => [
    section.label,
    section.notes.map((note) => note.slug.split("/").pop() ?? note.slug),
  ]);
}

it("routes diagram JSON to the diagram editor", () => {
  vault({ "diagrams/system.json": { type: "tldraw", version: 1, store: {} } });

  expect(getNoteIndex().notes[0]).toMatchObject({
    slug: "diagrams/system",
    href: "/diagrams/system",
    isDiagram: true,
  });
});

describe("titles and summaries", () => {
  it("drops trailing hashtags and skips metadata, ref lines and ## Links", () => {
    vault({
      "task-notes/2026-09-24-abc.json": [
        heading("PTF-4897 Analytics documentation #analytics #mobile-app"),
        paragraph("Date: 2026-09-24"),
        heading("Links", 2),
        paragraph("Task: Open in Work"),
        paragraph("-"),
        heading("Context", 2),
        paragraph("Jose flagged the ", link("https://example.com", "blur library"), " on iOS."),
      ],
      "pr-reviews/acme-capi-673.json": [
        heading("Change story ids to postrefs"),
        paragraph(link("https://github.com/acme/capi/pull/673", "capi#673")),
        paragraph("Verdict: Needs changes — the migration skips empty arrays."),
      ],
    });

    const bySlug = new Map(getNoteIndex().notes.map((note) => [note.slug, note]));
    expect(bySlug.get("task-notes/2026-09-24-abc")).toMatchObject({
      title: "PTF-4897 Analytics documentation",
      summary: "Jose flagged the blur library on iOS.",
    });
    expect(bySlug.get("pr-reviews/acme-capi-673")?.summary).toBe(
      "Verdict: Needs changes — the migration skips empty arrays.",
    );
  });

  it("keeps a title that is nothing but a tag, and issue numbers mid-title", () => {
    vault({
      "a.json": [heading("#devhub")],
      "b.json": [heading("Fix #525 regression")],
    });

    const titles = getNoteIndex().notes.map((note) => note.title).sort();
    expect(titles).toEqual(["#devhub", "Fix #525 regression"]);
  });
});

describe("sections", () => {
  it("groups PR reviews by repo, newest PR first, keeping one-off repos", () => {
    vault({
      "pr-reviews/acme-capi-600.json": [heading("Older capi PR"), paragraph("capi#600")],
      "pr-reviews/acme-capi-673.json": [
        heading("Newer capi PR"),
        paragraph(link("https://github.com/acme/capi/pull/673", "capi#673")),
      ],
      "pr-reviews/north-ptf-4788-bridge.json": [heading("Branch review"), paragraph("north@ptf-4788-bridge")],
      // No ref line and no PR link: filed by a repo another note already named.
      "pr-reviews/north-ptf-4935-config.json": [heading("Tags only"), paragraph("Tags: #north")],
      "pr-reviews/acme-edit-ops-12.json": [heading("One-off"), paragraph("acme/edit-ops#12")],
      "pr-reviews/ptf-4484-feedback.json": [heading("No repo at all")],
    });

    expect(sectionsOf("pr-reviews")).toEqual([
      ["capi", ["acme-capi-673", "acme-capi-600"]],
      ["edit-ops", ["acme-edit-ops-12"]],
      ["north", expect.arrayContaining(["north-ptf-4788-bridge", "north-ptf-4935-config"])],
      [null, ["ptf-4484-feedback"]],
    ]);
  });

  it("does not file app-poc reviews under app", () => {
    vault({
      "pr-reviews/acme-app-1.json": [heading("App"), paragraph("app#1")],
      "pr-reviews/acme-app-poc-2.json": [heading("App POC"), paragraph("app-poc#2")],
      "pr-reviews/app-poc-ptf-1-branch.json": [heading("App POC branch")],
    });

    expect(sectionsOf("pr-reviews")).toEqual([
      ["app", ["acme-app-1"]],
      ["app-poc", expect.arrayContaining(["acme-app-poc-2", "app-poc-ptf-1-branch"])],
    ]);
  });

  it("buckets dated notes into this week, last week and months", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 25, 12)); // Friday; the week starts Monday 21st.
    vault({
      "task-notes/2026-09-24-a.json": [heading("A")],
      "task-notes/2026-09-21-b.json": [heading("B")],
      "task-notes/2026-09-20-c.json": [heading("C")],
      "task-notes/2026-09-13-d.json": [heading("D")],
      "task-notes/2026-08-02-e.json": [heading("E")],
    });

    expect(sectionsOf("task-notes")).toEqual([
      ["This week", ["2026-09-24-a", "2026-09-21-b"]],
      ["Last week", ["2026-09-20-c"]],
      ["September 2026", ["2026-09-13-d"]],
      ["August 2026", ["2026-08-02-e"]],
    ]);
  });

  it("folds one-note tickets and real subfolders into the unlabelled section", () => {
    vault({
      "discovery/PTF-4897-inventory.json": [heading("Inventory")],
      "discovery/PTF-4897-parity.json": [heading("Parity")],
      "discovery/PTF-5060-blur.json": [heading("Blur")],
      "learnings/devhub/a.json": [heading("A")],
      "learnings/devhub/b.json": [heading("B")],
      "learnings/fastly/c.json": [heading("C")],
      "learnings/d.json": [heading("D")],
    });

    expect(sectionsOf("discovery")).toEqual([
      ["PTF-4897", expect.arrayContaining(["PTF-4897-inventory", "PTF-4897-parity"])],
      [null, ["PTF-5060-blur"]],
    ]);
    expect(sectionsOf("learnings")).toEqual([
      ["devhub", expect.arrayContaining(["a", "b"])],
      [null, expect.arrayContaining(["c", "d"])],
    ]);
  });

  it("does not wrap an area in a single section", () => {
    vault({
      "archive/email/a.json": [heading("A")],
      "archive/email/b.json": [heading("B")],
    });

    expect(sectionsOf("archive")).toEqual([[null, expect.arrayContaining(["a", "b"])]]);
  });
});

it("orders areas busiest first, with secondary areas last", () => {
  vault({
    "archive/a.json": [heading("A")],
    "archive/b.json": [heading("B")],
    "archive/c.json": [heading("C")],
    "daily/2026-09-24.json": [heading("Today")],
    "pr-reviews/acme-capi-1.json": [heading("One")],
    "pr-reviews/acme-capi-2.json": [heading("Two")],
  });

  expect(getNoteIndex().areas.map((area) => area.meta.id)).toEqual(["pr-reviews", "daily", "archive"]);
});
