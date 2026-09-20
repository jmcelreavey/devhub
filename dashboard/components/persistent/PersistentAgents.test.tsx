// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersistentAgents } from "./PersistentAgents";
import { requestAgentConversation } from "@/lib/agent-handoff";

const route = vi.hoisted(() => ({ pathname: "/agents", query: "conversation=first" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname, useSearchParams: () => new URLSearchParams(route.query) }));
beforeEach(() => {
  route.pathname = "/agents"; route.query = "conversation=first";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ origin: "http://127.0.0.1:25808" }) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("persistent Agents", () => {
  it("preserves the selected chat and frame when background data changes and a page is revisited", async () => {
    const view = render(<PersistentAgents />);
    const frame = await screen.findByTitle("Agents — AionUi");
    await waitFor(() => expect(frame.getAttribute("src")).toContain("/conversation/first"));
    // AionUi selected a different chat internally; DevHub must not reapply its old link.
    frame.setAttribute("src", "http://localhost:25808/#/conversation/selected-inside-aion");
    route.pathname = "/notes"; route.query = "";
    view.rerender(<PersistentAgents />);
    route.pathname = "/agents"; route.query = "conversation=first";
    view.rerender(<PersistentAgents />);
    expect(screen.getByTitle("Agents — AionUi")).toBe(frame);
    expect(frame.getAttribute("src")).toContain("selected-inside-aion");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("allows an explicit Open chat action to select the same linked chat again", async () => {
    render(<PersistentAgents />);
    const frame = await screen.findByTitle("Agents — AionUi");
    await waitFor(() => expect(frame.getAttribute("src")).toContain("/conversation/first"));
    frame.setAttribute("src", "http://localhost:25808/#/conversation/other");
    act(() => requestAgentConversation("first"));
    expect(frame.getAttribute("src")).toContain("/conversation/first");
  });
});
