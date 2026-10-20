// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const ui = vi.hoisted(() => ({ jev: true, query: "run=older&task=task-one", replace: vi.fn(), mutate: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: ui.replace }), useSearchParams: () => new URLSearchParams(ui.query) }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: () => ({
  data: {
    scenarios: [{ id: "first", title: "First scenario", surface: "dom" }, { id: "repro", title: "Failed reproduction", surface: "dom" }],
    runs: [
      { id: "latest", scenarioId: "first", state: "finished", createdAt: "2026-10-16T10:00:00Z" },
      { id: "older", scenarioId: "repro", state: "finished", createdAt: "2026-10-16T09:00:00Z" },
    ],
    settings: { visionModel: "", visionEffort: "", minConfidence: 0.65, experimentalImages: false },
    models: [], defaultModel: "", configured: { jev: ui.jev, vision: false, desktop: false },
  }, mutate: ui.mutate,
}) }));
import QaClient from "./client";

beforeEach(() => {
  vi.clearAllMocks();
  ui.query = "run=older&task=task-one";
  ui.jev = true;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ run: { id: "new-run" } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("QA without a Jev key", () => {
  it("links straight to the Setup step instead of describing env files", () => {
    ui.jev = false;
    render(<QaClient />);
    expect(screen.getByRole("link", { name: "Add your TypeSafe key in Setup" })).toHaveAttribute("href", "/setup?step=jev");
    expect(screen.queryByText(/\.env file/)).toBeNull();
  });
});

describe("QA receipt navigation", () => {
  it("reruns the selected receipt's scenario and preserves its verification task", async () => {
    render(<QaClient />);
    expect(screen.getByRole("combobox", { name: "Scenario" })).toHaveValue("repro");
    fireEvent.click(screen.getByRole("button", { name: "Run verification" }));
    await waitFor(() => expect(ui.replace).toHaveBeenCalledWith("/qa?run=new-run&task=task-one"));
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body).toMatchObject({ action: "run", scenarioId: "repro", taskId: "task-one" });
    expect(screen.getByRole("link", { name: "Storyboard" })).toHaveAttribute("href", "/storyboard?task=task-one");
  });
  it("does not substitute the newest receipt for a missing run", () => {
    ui.query = "run=missing";
    render(<QaClient />);
    expect(screen.getByText("Run not found")).toBeInTheDocument();
    expect(screen.getAllByRole("link").filter(link => link.getAttribute("aria-current") === "true")).toHaveLength(0);
  });
});
