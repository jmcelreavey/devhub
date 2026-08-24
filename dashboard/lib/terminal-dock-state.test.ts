import { describe, expect, it } from "vitest";
import {
  DOCK_FRAMES,
  DOCK_MIN_HEIGHT,
  DOCK_TOP_GUTTER,
  LONG_RUNNING_MS,
  NOTIFY_MIN_MS,
  POPOUT_KEEP_VISIBLE,
  UNPROVEN_SHELL_GRACE_MS,
  clampDockHeight,
  clampPopoutPos,
  parseDockFrame,
  parsePersistedDockState,
  shouldExpandOnTerminalOpen,
  shouldFallBackToRawView,
  shouldNotifyCommandFinished,
} from "./terminal-dock-state";

describe("shouldExpandOnTerminalOpen", () => {
  it("expands when the user has not collapsed the dock", () => {
    expect(shouldExpandOnTerminalOpen({ userCollapsed: false })).toBe(true);
  });

  it("stays collapsed after the user hid the dock", () => {
    expect(shouldExpandOnTerminalOpen({ userCollapsed: true })).toBe(false);
  });

  it("honours the always-expand preference over collapse", () => {
    expect(shouldExpandOnTerminalOpen({ userCollapsed: true, alwaysExpand: true })).toBe(true);
  });
});

describe("parsePersistedDockState", () => {
  it("returns null for empty or garbage input", () => {
    expect(parsePersistedDockState(null)).toBeNull();
    expect(parsePersistedDockState("")).toBeNull();
    expect(parsePersistedDockState("{")).toBeNull();
    expect(parsePersistedDockState(JSON.stringify({ tabs: [] }))).toBeNull();
  });

  it("round-trips a valid tab list and drops bad entries", () => {
    const state = parsePersistedDockState(
      JSON.stringify({
        tabs: [
          {
            id: 1,
            label: "app-poc",
            cwd: "/Users/jm/Developer/app-poc",
            sessionId: "11111111-1111-1111-1111-111111111111",
          },
          { id: "nope", label: "bad" },
          { id: 2, label: "zsh", sessionId: null },
        ],
        activeId: 2,
        nextId: 5,
        open: false,
        userCollapsed: true,
      }),
    );
    expect(state).toEqual({
      tabs: [
        {
          id: 1,
          label: "app-poc",
          cwd: "/Users/jm/Developer/app-poc",
          sessionId: "11111111-1111-1111-1111-111111111111",
        },
        { id: 2, label: "zsh", sessionId: null },
      ],
      activeId: 2,
      nextId: 5,
      open: false,
      userCollapsed: true,
    });
  });

  it("falls back activeId and nextId when missing", () => {
    const state = parsePersistedDockState(
      JSON.stringify({ tabs: [{ id: 3, label: "zsh" }], open: true }),
    );
    expect(state?.activeId).toBe(3);
    expect(state?.nextId).toBe(3);
    expect(state?.open).toBe(true);
    expect(state?.userCollapsed).toBe(false);
  });
});

describe("dock height", () => {
  it("clamps below the minimum up to the floor", () => {
    expect(clampDockHeight(10, 900)).toBe(DOCK_MIN_HEIGHT);
  });

  it("never covers the top gutter", () => {
    expect(clampDockHeight(5_000, 900)).toBe(900 - DOCK_TOP_GUTTER);
  });

  it("keeps a sensible height untouched", () => {
    expect(clampDockHeight(420, 900)).toBe(420);
  });

  it("stays usable on a very short viewport", () => {
    expect(clampDockHeight(400, 200)).toBe(DOCK_MIN_HEIGHT);
  });
});

describe("parseDockFrame", () => {
  it("accepts every known frame", () => {
    for (const frame of DOCK_FRAMES) expect(parseDockFrame(frame)).toBe(frame);
  });

  it("rejects anything else", () => {
    expect(parseDockFrame("wobble")).toBeNull();
    expect(parseDockFrame(undefined)).toBeNull();
  });

  it("no longer accepts the removed maximise/minimise frames", () => {
    expect(parseDockFrame("max")).toBeNull();
    expect(parseDockFrame("min")).toBeNull();
  });
});

describe("clampPopoutPos", () => {
  const size = { w: 720, h: 520 };
  const viewport = { w: 1440, h: 900 };

  it("leaves a window that is fully on screen alone", () => {
    expect(clampPopoutPos({ x: 200, y: 120 }, size, viewport)).toEqual({ x: 200, y: 120 });
  });

  it("keeps a sliver grabbable when dragged off the left", () => {
    expect(clampPopoutPos({ x: -5_000, y: 100 }, size, viewport).x).toBe(
      POPOUT_KEEP_VISIBLE - size.w,
    );
  });

  it("keeps a sliver grabbable when dragged off the right", () => {
    expect(clampPopoutPos({ x: 5_000, y: 100 }, size, viewport).x).toBe(
      viewport.w - POPOUT_KEEP_VISIBLE,
    );
  });

  it("never lets the title bar go above the viewport", () => {
    expect(clampPopoutPos({ x: 200, y: -300 }, size, viewport).y).toBe(0);
  });

  it("never lets the window fall past the bottom", () => {
    expect(clampPopoutPos({ x: 200, y: 5_000 }, size, viewport).y).toBe(
      viewport.h - POPOUT_KEEP_VISIBLE,
    );
  });
});

describe("shouldNotifyCommandFinished", () => {
  const base = {
    startedAt: 1_000,
    now: 1_000 + NOTIFY_MIN_MS,
    notifyEnabled: true,
    dockOpen: false,
    documentHidden: true,
    permission: "granted" as const,
  };

  it("notifies for a long command you weren't watching", () => {
    expect(shouldNotifyCommandFinished(base)).toBe(true);
  });

  it("stays quiet for a command that finished quickly", () => {
    expect(shouldNotifyCommandFinished({ ...base, now: base.startedAt + 500 })).toBe(false);
  });

  it("stays quiet when the dock is open in front of you", () => {
    expect(
      shouldNotifyCommandFinished({ ...base, dockOpen: true, documentHidden: false }),
    ).toBe(false);
  });

  it("still notifies when the dock is open but the tab is hidden", () => {
    expect(
      shouldNotifyCommandFinished({ ...base, dockOpen: true, documentHidden: true }),
    ).toBe(true);
  });

  it("respects the preference being off", () => {
    expect(shouldNotifyCommandFinished({ ...base, notifyEnabled: false })).toBe(false);
  });

  it("never notifies without permission, including where Notification is unsupported", () => {
    expect(shouldNotifyCommandFinished({ ...base, permission: "default" })).toBe(false);
    expect(shouldNotifyCommandFinished({ ...base, permission: "denied" })).toBe(false);
    expect(shouldNotifyCommandFinished({ ...base, permission: "unsupported" })).toBe(false);
  });

  it("cannot notify about a command it never saw start", () => {
    expect(shouldNotifyCommandFinished({ ...base, startedAt: undefined })).toBe(false);
  });
});

describe("shouldFallBackToRawView", () => {
  const now = 100_000;
  const pending = (ageMs: number) => ({ pending: true, startedAt: now - ageMs });
  const done = { pending: false, startedAt: now - 60_000 };

  it("falls back when a proven shell streams past the long-running mark", () => {
    expect(
      shouldFallBackToRawView({ blocks: [done, pending(LONG_RUNNING_MS + 1)], now, busy: true }),
    ).toBe(true);
  });

  it("stays in blocks while the shell is quiet, however long it has been pending", () => {
    expect(shouldFallBackToRawView({ blocks: [done, pending(60_000)], now, busy: false })).toBe(false);
  });

  it("gives an unproven shell a longer grace period", () => {
    const young = { blocks: [pending(LONG_RUNNING_MS + 1)], now, busy: true };
    const old = { blocks: [pending(UNPROVEN_SHELL_GRACE_MS + 1)], now, busy: true };
    expect(shouldFallBackToRawView(young)).toBe(false);
    expect(shouldFallBackToRawView(old)).toBe(true);
  });

  it("does nothing when there is no pending block", () => {
    expect(shouldFallBackToRawView({ blocks: [done], now, busy: true })).toBe(false);
    expect(shouldFallBackToRawView({ blocks: [], now, busy: true })).toBe(false);
  });

  it("does not flip on a block that only just started", () => {
    expect(shouldFallBackToRawView({ blocks: [done, pending(500)], now, busy: true })).toBe(false);
  });
});
