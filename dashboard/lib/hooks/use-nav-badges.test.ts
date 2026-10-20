/** @vitest-environment jsdom */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { countForItem, useNavBadges } from "./use-nav-badges";
import type { SidebarCounts } from "./use-sidebar-counts";

const state = vi.hoisted(() => ({ actionablePrs: 0 as number | null }));
vi.mock("./use-sidebar-counts", () => ({ useSidebarCounts: () => ({ prs: 84, actionablePrs: state.actionablePrs, signatures: { tickets: "", prs: "new-inventory" } }) }));
vi.mock("@/lib/read-status", () => ({ READ_STATUS_KEYS: {}, useIsUnseen: () => true }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: () => ({ data: { events: [] } }) }));
afterEach(cleanup);

const counts: SidebarCounts = { tasks: 50, tickets: 20, prs: 84, shared: 1, needsYou: 4, actionablePrs: 3, signatures: { tickets: "", prs: "" } };

describe("navigation action badges", () => {
  it("shows Needs you only on Home, without duplicating it on Storyboard", () => {
    expect(countForItem("today", counts)).toBe(4);
    expect(countForItem("storyboard", counts)).toBe(0);
    expect(countForItem("prs", counts)).toBe(3);
    expect(countForItem("tasks", counts)).toBe(50);
    expect(countForItem("calendar", counts, { calendarRemaining: 2 })).toBe(2);
  });

  it("never falls back to inventory when the actionable count is unavailable", () => {
    expect(countForItem("prs", { ...counts, actionablePrs: null })).toBe(0);
    expect(countForItem("storyboard", { ...counts, needsYou: null })).toBe(0);
    expect(countForItem("prs", { ...counts, actionablePrs: undefined })).toBe(0);
  });

  it("doesn't light the PR activity dot for ordinary open inventory or unknown action counts", () => {
    const { result, rerender } = renderHook(() => useNavBadges());
    expect(result.current.unseen.prs).toBe(false);
    state.actionablePrs = null;
    rerender();
    expect(result.current.unseen.prs).toBe(false);
    state.actionablePrs = 2;
    rerender();
    expect(result.current.unseen.prs).toBe(true);
  });
});
