/** @vitest-environment jsdom */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { TerminalDock } from "./TerminalDock";
import { AGENT_TAB_CLOSE_DELAY_MS, TERMINAL_DOCK_STORAGE_KEY } from "@/lib/terminal-dock-state";

type SessionProps = ComponentProps<typeof import("./TerminalSession").TerminalSession>;
const session = vi.hoisted(() => ({ props: null as SessionProps | null, dispose: vi.fn() }));
vi.mock("./TerminalSession", () => ({
  TerminalSession: (props: SessionProps) => { session.props = props; return null; },
  TERMINAL_FONT_SIZE_DEFAULT: 13,
  TERMINAL_FONT_SIZE_MIN: 10,
  TERMINAL_FONT_SIZE_MAX: 24,
  readTerminalFontSize: () => 13,
  writeTerminalFontSize: vi.fn(),
}));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/desktop/bridge", () => ({
  notifyPermission: async () => "unsupported",
  notify: vi.fn(),
  requestNotifyPermission: vi.fn(),
}));

function mountTab(fields: Record<string, unknown> = {}) {
  sessionStorage.setItem(TERMINAL_DOCK_STORAGE_KEY, JSON.stringify({
    tabs: [{ id: 1, label: "test command", sessionId: "11111111-1111-4111-8111-111111111111", agentRun: true, ...fields }],
    activeId: 1, nextId: 1, open: false, userCollapsed: true,
  }));
  return render(<TerminalDock />);
}

function tabCount() {
  return JSON.parse(sessionStorage.getItem(TERMINAL_DOCK_STORAGE_KEY) ?? '{"tabs":[]}').tabs.length;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  session.props = null;
  session.dispose.mockClear();
  vi.stubGlobal("EventSource", class { close() {} });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("agent terminal cleanup", () => {
  it.each([0, 1, 130])("closes a restored completed tab with exit %s", async (agentExitCode) => {
    mountTab({ agentExitCode });
    await act(async () => { await vi.advanceTimersByTimeAsync(AGENT_TAB_CLOSE_DELAY_MS); });
    expect(tabCount()).toBe(0);
  });

  it("keeps a silent running command, then retries cleanup after temporary busy output", async () => {
    mountTab({ agentCommandPending: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(tabCount()).toBe(1);
    act(() => { session.props?.onCommandExit?.(1); });
    act(() => { session.props?.onBusy?.(true); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(tabCount()).toBe(1);
    act(() => { session.props?.onBusy?.(false); });
    await act(async () => { await vi.advanceTimersByTimeAsync(AGENT_TAB_CLOSE_DELAY_MS); });
    expect(tabCount()).toBe(0);
  });

  it("keeps a terminal taken over by a new user command", async () => {
    mountTab({ agentExitCode: 0 });
    act(() => { session.props?.onCommandSubmit?.("npm run dev"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(tabCount()).toBe(1);
  });

  it("never closes a user tab or a disconnected run without a result", async () => {
    mountTab({ agentRun: false, agentExitCode: 0 });
    act(() => { session.props?.onStatus?.("closed"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(tabCount()).toBe(1);
  });
});
