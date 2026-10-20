// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentCapacityPanel } from "./AgentCapacityPanel";

const run = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, title: `Run ${id}`, providerLabel: "cursor", state: "running", conversationId: `chat-${id}`,
  createdAt: Date.UTC(2026, 9, 12, 10, 0), error: null, clearable: false, ...overrides,
});
let runs: ReturnType<typeof run>[];
let request: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  runs = [
    run("live"),
    run("stale", { state: "needs-attention", clearable: true, error: "The agent is no longer available in Paseo." }),
  ];
  request = vi.fn<typeof fetch>(async (url, init) => {
    const href = String(url);
    if (href === "/api/agent/runs/capacity") return Response.json({ max: 2, runs });
    if (href === "/api/agent/runs/stale/clear" && init?.method === "POST") { runs = runs.filter((r) => r.id !== "stale"); return Response.json({ outcome: "cleared" }); }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", request);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("AgentCapacityPanel", () => {
  it("lists what holds the limit and offers Clear only for runs DevHub can't follow", async () => {
    render(<AgentCapacityPanel />);
    expect(await screen.findByText("Run live")).toBeTruthy();
    expect(screen.getByText("2 of 2 agent slots in use", { exact: false })).toBeTruthy();
    expect(screen.getByText("The agent is no longer available in Paseo.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Clear" })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Open" })).toHaveLength(2);
  });

  it("clears a stale run, refreshes the list and reports the freed slot", async () => {
    const onFreed = vi.fn();
    render(<AgentCapacityPanel onFreed={onFreed} />);
    fireEvent.click(await screen.findByRole("button", { name: "Clear" }));
    await waitFor(() => expect(onFreed).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Run stale")).toBeNull();
    expect(screen.getByText("1 of 2 agent slots in use", { exact: false })).toBeTruthy();
  });

  it("shows why a clear failed and keeps the run listed", async () => {
    request.mockImplementation(async (url) => String(url) === "/api/agent/runs/capacity"
      ? Response.json({ max: 2, runs })
      : Response.json({ error: "This agent is still running. Stop it instead of clearing it." }, { status: 409 }));
    const onFreed = vi.fn();
    render(<AgentCapacityPanel onFreed={onFreed} />);
    fireEvent.click(await screen.findByRole("button", { name: "Clear" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "This agent is still running. Stop it instead of clearing it.");
    expect(onFreed).not.toHaveBeenCalled();
    expect(screen.getByText("Run stale")).toBeTruthy();
  });
});
