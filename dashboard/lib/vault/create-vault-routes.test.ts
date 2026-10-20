import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
const write = vi.hoisted(() => vi.fn());

vi.mock("@/lib/vault/vault-registry", () => ({
  getVaultStorage: vi.fn(() => ({ read, write })),
  getVault: vi.fn(() => ({ revalidatePaths: [] })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createVaultRoutes } from "./create-vault-routes";

describe("conditional note writes", () => {
  const { PUT } = createVaultRoutes("notes");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an autosave based on an older note version", async () => {
    read.mockReturnValue({ modified: 200 });
    const request = new NextRequest("http://test/api/notes/daily/test", {
      method: "PUT",
      body: JSON.stringify({ content: [], expectedModified: 100 }),
    });

    const response = await PUT(request, {
      params: Promise.resolve({ path: ["daily", "test"] }),
    });

    expect(response.status).toBe(409);
    expect(write).not.toHaveBeenCalled();
  });

  it("writes when the expected note version is current", async () => {
    read.mockReturnValue({ modified: 200 });
    write.mockReturnValue({ content: [], modified: 201 });
    const request = new NextRequest("http://test/api/notes/daily/test", {
      method: "PUT",
      body: JSON.stringify({ content: [], expectedModified: 200 }),
    });

    const response = await PUT(request, {
      params: Promise.resolve({ path: ["daily", "test"] }),
    });

    expect(response.status).toBe(200);
    expect(write).toHaveBeenCalledWith("daily/test", []);
  });

  describe("task notes saved from the visual editor", () => {
    const stored = [
      { id: "h", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Task", styles: {} }], children: [] },
      { id: "s", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Summary", styles: {} }], children: [] },
      { id: "p", type: "paragraph", props: {}, content: [{ type: "text", text: "From the agent.", styles: {} }], children: [] },
      { id: "n", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Notes", styles: {} }], children: [] },
      { id: "f", type: "paragraph", props: {}, content: [{ type: "text", text: "old free-form", styles: {} }], children: [] },
    ];
    const mine = [
      { id: "h", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Task", styles: {} }], children: [] },
      { id: "n", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Notes", styles: {} }], children: [] },
      { id: "f2", type: "paragraph", props: {}, content: [{ type: "text", text: "my free-form", styles: {} }], children: [] },
    ];
    const put = (path: string[], body: object) =>
      PUT(new NextRequest(`http://test/api/notes/${path.join("/")}`, { method: "PUT", body: JSON.stringify(body) }), {
        params: Promise.resolve({ path }),
      });

    it("keeps the agent's sections and saves the free-form blocks when asked to merge", async () => {
      read.mockReturnValue({ modified: 200, content: stored });
      write.mockImplementation((_path: string, content: unknown) => ({ content, modified: 201 }));
      const response = await put(["task-notes", "t"], { content: mine, expectedModified: 100, mergeAgentSections: true });
      expect(response.status).toBe(200);
      const written = JSON.stringify(write.mock.calls[0][1]);
      expect(written).toContain("From the agent.");
      expect(written).toContain("my free-form");
      expect(written).not.toContain("old free-form");
      const body = await response.json();
      expect(body.modified).toBe(201);
      expect(body.merged).toEqual(write.mock.calls[0][1]);
    });

    it("still answers 409 without the merge flag, outside task notes, or when the note is gone", async () => {
      read.mockReturnValue({ modified: 200, content: stored });
      expect((await put(["task-notes", "t"], { content: mine, expectedModified: 100 })).status).toBe(409);
      expect((await put(["daily", "t"], { content: mine, expectedModified: 100, mergeAgentSections: true })).status).toBe(409);
      read.mockReturnValue(null);
      expect((await put(["task-notes", "t"], { content: mine, expectedModified: 100, mergeAgentSections: true })).status).toBe(409);
      expect(write).not.toHaveBeenCalled();
    });

    it("does not merge when the version is current", async () => {
      read.mockReturnValue({ modified: 100, content: stored });
      write.mockImplementation((_path: string, content: unknown) => ({ content, modified: 101 }));
      const response = await put(["task-notes", "t"], { content: mine, expectedModified: 100, mergeAgentSections: true });
      expect(write.mock.calls[0][1]).toEqual(mine);
      expect((await response.json()).merged).toBeUndefined();
    });
  });

  it("rejects deleting a note whose version changed", async () => {
    read.mockReturnValue({ modified: 300 });
    const { DELETE } = createVaultRoutes("notes");
    const request = new NextRequest(
      "http://test/api/notes/daily/test?expectedModified=200",
      { method: "DELETE" },
    );

    const response = await DELETE(request, {
      params: Promise.resolve({ path: ["daily", "test"] }),
    });

    expect(response.status).toBe(409);
  });
});
