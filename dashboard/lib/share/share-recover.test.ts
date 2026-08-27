import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShareRecord } from "./share-public";

async function load(home: string, notesDir: string, docsDir: string) {
  process.env.HOME = home;
  process.env.NOTES_DIR = notesDir;
  process.env.DOCS_DIR = docsDir;
  vi.resetModules();
  const recover = await import("./share-recover");
  const store = await import("./share-store");
  const content = await import("./share-content");
  return { recover, store, content };
}

function gistShare(overrides: Partial<ShareRecord> = {}): ShareRecord {
  const now = Date.now();
  return {
    key: "notes:projects/garden",
    vault: "notes",
    path: "projects/garden",
    title: "Garden",
    gistId: "abc123",
    url: "https://gist.github.com/me/abc123",
    createdAt: now,
    updatedAt: now,
    contentHash: "old-hash",
    ...overrides,
  };
}

let home: string;
let notesDir: string;
let docsDir: string;
const originalHome = process.env.HOME;
const originalNotes = process.env.NOTES_DIR;
const originalDocs = process.env.DOCS_DIR;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-share-recover-home-"));
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-share-recover-notes-"));
  docsDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-share-recover-docs-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(notesDir, { recursive: true, force: true });
  fs.rmSync(docsDir, { recursive: true, force: true });
  process.env.HOME = originalHome;
  if (originalNotes === undefined) delete process.env.NOTES_DIR;
  else process.env.NOTES_DIR = originalNotes;
  if (originalDocs === undefined) delete process.env.DOCS_DIR;
  else process.env.DOCS_DIR = originalDocs;
});

describe("recoverShareFromGist", () => {
  it("restores a missing notes source from a live gist without creating a new gist", async () => {
    const { recover, store, content } = await load(home, notesDir, docsDir);
    await store.upsertShare(gistShare());

    const fetchMarkdown = vi.fn(async () => "# Garden\n\nRestored from gist.");
    const record = await recover.recoverShareFromGist("notes", "projects/garden", { fetchMarkdown });

    expect(fetchMarkdown).toHaveBeenCalledWith("abc123");
    expect(record.gistId).toBe("abc123");
    expect(record.url).toBe("https://gist.github.com/me/abc123");
    expect(fs.existsSync(path.join(notesDir, "projects/garden.json"))).toBe(true);

    const statuses = content.listShareStatuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.missing).toBe(false);
    expect(statuses[0]?.stale).toBe(false);
    expect(statuses[0]?.gistId).toBe("abc123");
  });

  it("creates missing parent directories", async () => {
    const { recover, store } = await load(home, notesDir, docsDir);
    await store.upsertShare(
      gistShare({
        key: "notes:deep/nested/plan",
        path: "deep/nested/plan",
        title: "Plan",
      }),
    );

    await recover.recoverShareFromGist("notes", "deep/nested/plan", {
      fetchMarkdown: async () => "# Plan\n\nNested.",
    });

    expect(fs.existsSync(path.join(notesDir, "deep/nested/plan.json"))).toBe(true);
  });

  it("restores a missing doc as markdown", async () => {
    const { recover, store, content } = await load(home, notesDir, docsDir);
    await store.upsertShare(
      gistShare({
        key: "docs:runbook",
        vault: "docs",
        path: "runbook",
        title: "Runbook",
      }),
    );

    const markdown = "# Runbook\n\nDo the thing.\n";
    await recover.recoverShareFromGist("docs", "runbook", {
      fetchMarkdown: async () => markdown,
    });

    expect(fs.readFileSync(path.join(docsDir, "runbook.md"), "utf8")).toBe(markdown);
    expect(content.listShareStatuses()[0]?.missing).toBe(false);
  });

  it("errors when the gist is gone", async () => {
    const { recover, store } = await load(home, notesDir, docsDir);
    await store.upsertShare(gistShare());

    await expect(
      recover.recoverShareFromGist("notes", "projects/garden", {
        fetchMarkdown: async () => {
          throw new Error("HTTP 404: Not Found");
        },
      }),
    ).rejects.toMatchObject({ name: "ShareRecoverError", status: 404, message: "Gist not found" });

    expect(fs.existsSync(path.join(notesDir, "projects/garden.json"))).toBe(false);
  });

  it("refuses to overwrite a different file that now occupies the path", async () => {
    const { recover, store } = await load(home, notesDir, docsDir);
    await store.upsertShare(gistShare());

    const occupied = path.join(notesDir, "projects/garden.json");
    fs.mkdirSync(path.dirname(occupied), { recursive: true });
    fs.writeFileSync(occupied, JSON.stringify([{ type: "paragraph", content: "NOPE" }]));

    await expect(
      recover.recoverShareFromGist("notes", "projects/garden", {
        fetchMarkdown: async () => "# Garden\n\nShould not land.",
      }),
    ).rejects.toMatchObject({ name: "ShareRecoverError", status: 409 });

    expect(fs.readFileSync(occupied, "utf8")).toContain("NOPE");
  });

  it("blocks path traversal", async () => {
    const { recover, store } = await load(home, notesDir, docsDir);
    await store.upsertShare(
      gistShare({
        key: "notes:../outside",
        path: "../outside",
      }),
    );

    await expect(
      recover.recoverShareFromGist("notes", "../outside", {
        fetchMarkdown: async () => "# Nope",
      }),
    ).rejects.toMatchObject({ name: "ShareRecoverError", status: 400, message: "Path traversal blocked" });

    expect(fs.existsSync(path.join(notesDir, "..", "outside.json"))).toBe(false);
  });
});
