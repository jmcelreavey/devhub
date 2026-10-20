/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LegacyWorkRedirect } from "./LegacyWorkRedirect";

const mocks = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }), useSearchParams: () => new URLSearchParams(window.location.search) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("legacy task routes while Work parity is incomplete", () => {
  it.each(["tasks", "jira"] as const)("preserves parameters and the hash for %s", async (tab) => {
    const search = "q=fix+login&tag=bug&date=2026-10-18&task=id&taskSection=evidence&repo=api&jira=TEST-1&parentJira=TEST-2&extra=a&extra=b";
    window.history.replaceState(null, "", `/tasks?${search}#notes`);
    render(<LegacyWorkRedirect tab={tab} />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(`/work?${search}&tab=${tab}#notes`, { scroll: false }));
  });
  it("keeps unknown tab and query state in the old Work view", async () => {
    window.history.replaceState(null, "", "/tasks?tab=future&unsupported=keep#old");
    render(<LegacyWorkRedirect tab="tasks" />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/work?tab=future&unsupported=keep#old", { scroll: false }));
  });
});
