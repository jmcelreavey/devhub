import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openPathInCursor = vi.hoisted(() => vi.fn(() => null));
const materializeGitRevisionFile = vi.hoisted(() =>
  vi.fn(async () => ({ absolutePath: "/tmp/cache/a.ts", shortHash: "abc1234" })),
);
const readNote = vi.hoisted(() => vi.fn());
const writeNote = vi.hoisted(() => vi.fn());
const createCursorDraft = vi.hoisted(() =>
  vi.fn(() => ({ markdownPath: "/tmp/review.md", writable: true })),
);
const getCursorDraft = vi.hoisted(() => vi.fn());
const applyCursorDraft = vi.hoisted(() => vi.fn(() => [{ type: "paragraph" }]));
const deleteCursorDraft = vi.hoisted(() => vi.fn(() => true));
const blocksToText = vi.hoisted(() => vi.fn());
const textToBlocks = vi.hoisted(() => vi.fn(() => [{ type: "paragraph", content: "with links" }]));
const parseEntityLinksFromMarkdown = vi.hoisted(() => vi.fn());
const mergeEntityRefs = vi.hoisted(() => vi.fn());
const upsertEntityLinksInMarkdown = vi.hoisted(() => vi.fn());

vi.mock("@/lib/cursor-open", () => ({ openPathInCursor }));
vi.mock("@/lib/git/open-at-revision", () => ({ materializeGitRevisionFile }));
vi.mock("@/lib/notes/cursor-draft", () => ({
  createCursorDraft,
  getCursorDraft,
  applyCursorDraft,
  deleteCursorDraft,
  CursorDraftError: class CursorDraftError extends Error {},
}));
vi.mock("@/lib/markdown-convert", () => ({ blocksToText, textToBlocks }));
vi.mock("@/lib/entity-note", () => ({
  mergeEntityRefs,
  parseEntityLinksFromMarkdown,
  upsertEntityLinksInMarkdown,
}));
vi.mock("@/lib/scanned-repo", () => ({
  resolveScannedRepo: vi.fn(() => "/tmp/test-repo"),
}));
vi.mock("@/lib/vault/vault-registry", () => ({
  getVaultStorage: vi.fn(() => ({ root: "/tmp/notes", read: readNote, write: writeNote })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { DELETE, GET, PATCH, POST } from "./route";

describe("POST /api/repos/[name]/open", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeNote.mockReturnValue({ content: [{ type: "paragraph" }] });
    blocksToText.mockReturnValue("# Draft");
    parseEntityLinksFromMarkdown.mockReturnValue([]);
    mergeEntityRefs.mockReturnValue([]);
    upsertEntityLinksInMarkdown.mockReturnValue("# Draft");
  });

  it("opens the repository and a Markdown working copy in one Cursor launch", async () => {
    readNote.mockReturnValue({ content: [{ type: "paragraph" }] });
    const request = new NextRequest("http://test/api/repos/test-repo/open", {
      method: "POST",
      body: JSON.stringify({ notePath: "daily/test" }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ name: "test-repo" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ writable: true });
    expect(createCursorDraft).toHaveBeenCalledWith(
      "test-repo",
      "daily/test",
      [{ type: "paragraph" }],
      "/tmp/notes",
    );
    expect(openPathInCursor).toHaveBeenCalledWith("/tmp/test-repo", ["/tmp/review.md"]);
  });

  it("finds a persisted working copy for a linked repository", async () => {
    readNote.mockReturnValue({ content: [{ type: "paragraph" }] });
    getCursorDraft.mockReturnValue({ writable: true });
    const request = new NextRequest("http://test/api/repos/test-repo/open?notePath=daily/test");

    const response = await GET(request, {
      params: Promise.resolve({ name: "test-repo" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ draft: { writable: true } });
    expect(getCursorDraft).toHaveBeenCalledWith("test-repo", "daily/test", "/tmp/notes");
  });

  it("applies the Markdown working copy to the source note", async () => {
    readNote.mockReturnValue({ content: [{ type: "paragraph", content: "old" }] });
    const request = new NextRequest("http://test/api/repos/test-repo/open", {
      method: "PATCH",
      body: JSON.stringify({ notePath: "daily/test" }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ name: "test-repo" }),
    });

    expect(response.status).toBe(200);
    expect(writeNote).toHaveBeenCalledWith("daily/test", [{ type: "paragraph", content: "with links" }]);
    expect(deleteCursorDraft).toHaveBeenCalledWith("test-repo", "daily/test", "/tmp/notes");
  });

  it("preserves source entity links when Cursor changes their Markdown", async () => {
    const source = [{ type: "paragraph", content: "old" }];
    const draft = [{ type: "paragraph", content: "new" }];
    readNote.mockReturnValue({ content: source });
    applyCursorDraft.mockReturnValue(draft);
    blocksToText.mockImplementation((blocks) => (blocks === source ? "**Repo:** insider-app" : "# Draft"));
    parseEntityLinksFromMarkdown.mockImplementation((markdown) =>
      markdown === "**Repo:** insider-app" ? [{ kind: "repo", id: "insider-app", label: "insider-app" }] : [],
    );
    mergeEntityRefs.mockReturnValue([{ kind: "repo", id: "insider-app", label: "insider-app" }]);
    upsertEntityLinksInMarkdown.mockReturnValue("# Draft\n\n## Links\n\n**Repo:** insider-app");
    const request = new NextRequest("http://test/api/repos/test-repo/open", {
      method: "PATCH",
      body: JSON.stringify({ notePath: "daily/test" }),
    });

    await PATCH(request, { params: Promise.resolve({ name: "test-repo" }) });

    expect(upsertEntityLinksInMarkdown).toHaveBeenCalledWith("# Draft", [
      { kind: "repo", id: "insider-app", label: "insider-app" },
    ]);
  });

  it("deletes the persistent Markdown working copy", async () => {
    const request = new NextRequest("http://test/api/repos/test-repo/open", {
      method: "DELETE",
      body: JSON.stringify({ notePath: "daily/test" }),
    });

    const response = await DELETE(request, {
      params: Promise.resolve({ name: "test-repo" }),
    });

    expect(response.status).toBe(200);
    expect(deleteCursorDraft).toHaveBeenCalledWith("test-repo", "daily/test", "/tmp/notes");
  });

  it("opens a materialized commit:path alongside the repo", async () => {
    const request = new NextRequest("http://test/api/repos/test-repo/open", {
      method: "POST",
      body: JSON.stringify({ filePath: "src/a.ts", commit: "abc1234def" }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ name: "test-repo" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      revisionPath: "/tmp/cache/a.ts",
      shortHash: "abc1234",
    });
    expect(materializeGitRevisionFile).toHaveBeenCalledWith(
      "/tmp/test-repo",
      "test-repo",
      "abc1234def",
      "src/a.ts",
    );
    expect(openPathInCursor).toHaveBeenCalledWith("/tmp/test-repo", ["/tmp/cache/a.ts"]);
  });

  it("rejects unsafe note paths", async () => {
    readNote.mockImplementation(() => {
      throw new Error("Path traversal blocked");
    });
    const request = new NextRequest("http://test/api/repos/test-repo/open", {
      method: "POST",
      body: JSON.stringify({ notePath: "../secret" }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ name: "test-repo" }),
    });

    expect(response.status).toBe(400);
    expect(openPathInCursor).not.toHaveBeenCalled();
  });
});
