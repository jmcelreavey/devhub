/** @vitest-environment jsdom */
import { act } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { SessionHistoryEntry } from "@/lib/session-history";

const stored = vi.hoisted(() => ({ history: [] as SessionHistoryEntry[] }));
vi.mock("next/navigation", () => ({ usePathname: () => "/setup" }));
vi.mock("@/components/shell/WorkspaceTabs", () => ({
  useWorkspaceTabs: () => ({ history: stored.history }),
}));
vi.mock("@/components/runs/ContentSyncIndicator", () => ({ ContentSyncIndicator: () => null }));
vi.mock("@/components/shell/AccentPicker", () => ({ AccentPicker: () => null }));
vi.mock("@/components/shell/ProfileSwitcher", () => ({ ProfileSwitcher: () => null }));
vi.mock("@/components/shell/QuickActions", () => ({ QuickActions: () => null }));
vi.mock("@/components/shell/SectionTabs", () => ({ SectionTabs: () => null }));
vi.mock("@/components/tasks/FocusTimer", () => ({ FocusTimer: () => null }));
vi.mock("@/components/ui/HoverTip", () => ({
  HoverTip: ({ children }: PropsWithChildren) => children,
}));

import { HubTopBar } from "./HubTopBar";

describe("HubTopBar hydration", () => {
  it("hydrates before showing history restored by the surrounding workspace", async () => {
    stored.history = [];
    const html = renderToString(<HubTopBar />);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    // The outer provider can restore localStorage while this Suspense boundary
    // is still waiting for its client chunk.
    stored.history = [{ href: "/notes", label: "Notes", ts: 1 }];
    const onRecoverableError = vi.fn();
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, <HubTopBar />, { onRecoverableError });
      });
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(container.querySelector('a[href="/notes"]')?.textContent).toBe("Notes");
    } finally {
      await act(async () => root?.unmount());
      container.remove();
      stored.history = [];
    }
  });
});
