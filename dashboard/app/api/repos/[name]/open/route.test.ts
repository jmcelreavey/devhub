import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openPathInCursor = vi.hoisted(() => vi.fn(() => null));
const readNote = vi.hoisted(() => vi.fn());
const writeNote = vi.hoisted(() => vi.fn());
const createCursorDraft = vi.hoisted(() =>
  vi.fn(() => ({ markdownPath: "/tmp/review.md", writable: true })),
);
const applyCursorDraft = vi.hoisted(() => vi.fn(() => [{ type: "paragraph" }]));
const markCursorDraftApplied = vi.hoisted(() => vi.fn());
const deleteCursorDraft = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/cursor-open", () => ({ openPathInCursor }));
vi.mock("@/lib/notes/cursor-draft", () => ({
  createCursorDraft,
  applyCursorDraft,
  deleteCursorDraft,
  markCursorDraftApplied,
  CursorDraftError: class CursorDraftError extends Error {},
}));
vi.mock("@/lib/scanned-repo", () => ({
  resolveScannedRepo: vi.fn(() => "/tmp/test-repo"),
}));
vi.mock("@/lib/vault/vault-registry", () => ({
  getVaultStorage: vi.fn(() => ({ root: "/tmp/notes", read: readNote, write: writeNote })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { DELETE, PATCH, POST } from "./route";

describe("POST /api/repos/[name]/open", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeNote.mockReturnValue({ content: [{ type: "paragraph" }] });
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
    expect(writeNote).toHaveBeenCalledWith("daily/test", [{ type: "paragraph" }]);
    expect(markCursorDraftApplied).toHaveBeenCalledWith(
      "test-repo",
      "daily/test",
      [{ type: "paragraph" }],
      "/tmp/notes",
    );
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
