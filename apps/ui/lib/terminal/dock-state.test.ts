import { afterEach, expect, it, vi } from "vitest";
import { parsePersistedDockState, readAutoRunPref, shouldInjectProposal } from "./dock-state";

afterEach(() => vi.unstubAllGlobals());

it("restores old tabs and session IDs while ignoring their renderer choices", () => {
  const state = parsePersistedDockState(JSON.stringify({
    tabs: [
      { id: 1, label: "Shell", sessionId: "session-1", engine: "xterm" },
      { id: 2, label: "Command", sessionId: "session-2", engine: "wterm" },
    ],
    activeId: 2,
    nextId: 2,
    open: true,
  }));

  expect(state?.tabs).toEqual([
    { id: 1, label: "Shell", sessionId: "session-1" },
    { id: 2, label: "Command", sessionId: "session-2" },
  ]);
  expect(state?.activeId).toBe(2);
});

it("defaults to auto-run while retaining destructive confirmation", () => {
  const getItem = vi.fn((): string | null => null);
  vi.stubGlobal("window", { localStorage: { getItem } });

  expect(readAutoRunPref()).toBe(true);
  expect(shouldInjectProposal({ autoRun: readAutoRunPref(), command: "echo hello" })).toBe(true);
  expect(shouldInjectProposal({ autoRun: readAutoRunPref(), command: "rm -rf /tmp/example" })).toBe(false);
  expect(shouldInjectProposal({ autoRun: true, command: "git push --force", skipConfirm: true })).toBe(false);
  expect(shouldInjectProposal({ autoRun: true, command: "echo hello", requiresConfirmation: true })).toBe(false);

  getItem.mockReturnValue("0");
  expect(readAutoRunPref()).toBe(false);
  expect(shouldInjectProposal({ autoRun: readAutoRunPref(), command: "echo hello" })).toBe(false);
  getItem.mockReturnValue("1");
  expect(readAutoRunPref()).toBe(true);
  getItem.mockReturnValue("other");
  expect(readAutoRunPref()).toBe(true);
  getItem.mockImplementation(() => { throw new Error("Storage unavailable"); });
  expect(readAutoRunPref()).toBe(true);
});
