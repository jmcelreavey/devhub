import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const openPathInCursor = vi.hoisted(() => vi.fn(() => null));
const createCursorDraft = vi.hoisted(() =>
  vi.fn(() => ({ markdownPath: "/tmp/review.md", writable: true })),
);

vi.mock("@/lib/cursor-open", () => ({ openPathInCursor }));
vi.mock("@/lib/notes/cursor-draft", () => ({
  applyCursorDraft: vi.fn(),
  createCursorDraft,
  CursorDraftError: class CursorDraftError extends Error {},
  deleteCursorDraft: vi.fn(),
  getCursorDraft: vi.fn(),
}));
vi.mock("@/lib/scanned-repo", () => ({ resolveScannedRepo: vi.fn(() => "/tmp/app") }));
vi.mock("@/lib/vault/vault-registry", () => ({
  getVaultStorage: vi.fn(() => ({
    read: vi.fn(() => ({ content: [{ type: "paragraph", content: "Review" }] })),
    root: "/tmp/notes",
  })),
}));

import { POST } from "./route";

describe("POST /api/repos/[name]/open", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens a note working copy when called by the MCP client", async () => {
    const request = new NextRequest("http://localhost:1337/api/repos/app/open", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:1337",
        "x-devhub-client": "mcp",
      },
      body: JSON.stringify({ notePath: "pr-reviews/app-ptf-4906" }),
    });

    const response = await POST(request, { params: Promise.resolve({ name: "app" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, writable: true });
    expect(createCursorDraft).toHaveBeenCalledWith(
      "app",
      "pr-reviews/app-ptf-4906",
      expect.anything(),
      "/tmp/notes",
    );
    expect(openPathInCursor).toHaveBeenCalledWith("/tmp/app", ["/tmp/review.md"]);
  });
});
