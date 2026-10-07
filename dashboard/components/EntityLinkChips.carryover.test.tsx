/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EntityLinkChips } from "./EntityLinkChips";
import type { EntityRef } from "@/lib/entity-note";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/hooks/use-tag-menu", () => ({ useTagMenuGroup: () => ({ group: null, modal: null }) }));
vi.mock("@/components/jira/JiraTransitionModal", () => ({ JiraTransitionModal: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("merges an old task link with its current alias and removes the stored ID", async () => {
  const original: EntityRef = { kind: "task", id: "old-task", label: "Old task title", href: "/work?tab=tasks" };
  const current: EntityRef = { kind: "task", id: "current-task", label: "Current task title", href: "/work?date=2026-09-24" };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ notes: [], related: [current], taskAliases: { "old-task": current } }),
  }));
  const remove = vi.fn().mockResolvedValue(undefined);
  render(<EntityLinkChips kind="task" id="host-task" seed={[original]} onRemoveSeed={remove} />);
  const link = await screen.findByRole("link", { name: "Current task title" });
  expect(link.getAttribute("href")).toBe("/work?date=2026-09-24");
  expect(screen.getAllByRole("link")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Remove Current task title link" }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith(original));
  expect(screen.queryByRole("link")).toBeNull();
});
