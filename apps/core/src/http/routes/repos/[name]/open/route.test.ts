import { expect, it, vi } from "vitest";
import { applyCursorDraft, CursorDraftError } from "../../../../../lib/notes/cursor-draft";
import { DELETE, GET, PATCH } from "./route";

const storage = vi.hoisted(() => ({ root: "/fixture/notes", read: vi.fn().mockReturnValue({ content: [] }), write: vi.fn() }));
vi.mock("../../../../../lib/vault/vault-registry", () => ({ getVaultStorage: () => storage }));
vi.mock("../../../../../lib/repos/scanned-repo", () => ({ resolveScannedRepo: (name: string) => name === "demo" ? "/fixture/demo" : null }));
vi.mock("../../../../../lib/notes/cursor-draft", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../../lib/notes/cursor-draft")>(),
  applyCursorDraft: vi.fn(),
  getCursorDraft: vi.fn().mockReturnValue({ writable: true }),
  deleteCursorDraft: vi.fn().mockReturnValue(false),
}));

it("preserves missing, stale and malformed Cursor draft protections", async () => {
  const params = { params: Promise.resolve({ name: "demo" }) };
  const request = (method: string, body: object) => new Request("http://localhost:1447/api/repos/demo/open", { method, body: JSON.stringify(body) });
  expect(await (await GET(new Request("http://localhost:1447/api/repos/demo/open?notePath=daily%2Fexample"), params)).json()).toEqual({ draft: { writable: true } });
  expect((await PATCH(request("PATCH", { notePath: "" }), params)).status).toBe(400);
  vi.mocked(applyCursorDraft).mockImplementation(() => { throw new CursorDraftError("Stale draft", 409); });
  expect((await PATCH(request("PATCH", { notePath: "daily/example" }), params)).status).toBe(409);
  expect(storage.write).not.toHaveBeenCalled();
  expect((await DELETE(request("DELETE", { notePath: "daily/example" }), params)).status).toBe(404);
  expect((await PATCH(request("PATCH", { notePath: "" }), { params: Promise.resolve({ name: "missing" }) })).status).toBe(404);
});
