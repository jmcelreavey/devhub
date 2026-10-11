import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./workspace", () => ({ editorWorkspace: () => "/workspace", selectionPath: vi.fn() }));
vi.mock("@/lib/agent-runs/dispatch", () => ({ AgentDispatchError: class extends Error { constructor(message: string, public status: number) { super(message); } } }));
import { pairEditor, pendingSelection, nextSelection, receiveSelection, revokeEditor } from "./pairing";
const selection = { workspaceId: "test", relativePath: "a.ts", revision: "v1", ranges: "1:1–2:1", selectedText: "const x = 1;", dirty: true, source: "editor" };
afterEach(() => { revokeEditor("test"); vi.useRealTimers(); });
describe("workspace pairing", () => {
  it("scopes credentials to one workspace and revokes queued previews", () => {
    const pair = pairEditor("test", "http://localhost:1337");
    const { token } = JSON.parse(Buffer.from(pair.code, "base64url").toString());
    expect(() => receiveSelection("wrong", selection)).toThrow("expired");
    expect(() => receiveSelection(token, { ...selection, workspaceId: "other" })).toThrow("expired");
    const id = receiveSelection(token, selection);
    expect(pendingSelection(id)?.selectedText).toBe(selection.selectedText);
    expect(nextSelection("other")).toBeNull();
    expect(nextSelection("test")?.id).toBe(id);
    revokeEditor("test");
    expect(pendingSelection(id)).toBeUndefined();
    expect(() => receiveSelection(token, selection)).toThrow("revoked");
  });
  it("expires credentials and selections and refuses remote pairing origins", () => {
    vi.useFakeTimers();
    expect(() => pairEditor("test", "https://remote.example")).toThrow("this computer");
    const { code } = pairEditor("test", "http://127.0.0.1:1337");
    const { token } = JSON.parse(Buffer.from(code, "base64url").toString());
    const id = receiveSelection(token, selection);
    vi.advanceTimersByTime(11 * 60_000);
    expect(pendingSelection(id)).toBeUndefined();
    vi.advanceTimersByTime(20 * 60_000);
    expect(() => receiveSelection(token, selection)).toThrow("expired");
  });
});
