/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutRebuildCard } from "./CheckoutRebuildCard";
import type { RebuildStatus } from "@/lib/desktop/checkout-rebuild";

const live = vi.hoisted(() => ({
  data: null as {
    available: boolean;
    mode: "service" | "payload" | null;
    checkoutAhead: boolean;
    status: RebuildStatus | null;
    log: string;
  } | null,
  error: undefined as Error | undefined,
  mutate: vi.fn(),
}));

const desktop = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/lib/hooks/use-fetch", () => ({
  useLive: () => live,
}));

vi.mock("@/lib/desktop/bridge", () => ({
  isDesktop: () => desktop.enabled,
}));

function status(state: RebuildStatus["state"]): RebuildStatus {
  return {
    state,
    phase: "restart",
    phases: [{ id: "restart", label: "Restart devhub.service", state: state === "interrupted" ? "running" : state }],
    error: state === "interrupted" ? "The rebuild was interrupted before it finished." : state === "failed" ? "npm install failed." : null,
    rolledBack: false,
    restartRequired: false,
    commit: null,
  };
}

describe("CheckoutRebuildCard", () => {
  beforeEach(() => {
    desktop.enabled = false;
    live.mutate.mockReset();
    live.error = undefined;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ message: "Rebuild started." }) })));
  });

  it("shows an interrupted rebuild as stopped and offers to run it again", () => {
    live.data = {
      available: true,
      mode: "service",
      checkoutAhead: false,
      status: status("interrupted"),
      log: "",
    };
    render(<CheckoutRebuildCard />);
    expect(screen.getByText(/interrupted before it finished/i)).toBeTruthy();
    expect(screen.getByText(/you can run it again/i)).toBeTruthy();
    expect(screen.getByText("Stopped")).toBeTruthy();
    expect(screen.queryByText("Now")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    const button = screen.getByRole("button", { name: /pull and rebuild/i });
    expect(button).toBeEnabled();
    expect(screen.queryByText(/rebuilding/i)).toBeNull();
    fireEvent.click(button);
    expect(fetch).toHaveBeenCalledWith("/api/rebuild", expect.objectContaining({ method: "POST" }));
  });

  it("treats a running rebuild as busy", () => {
    live.data = {
      available: true,
      mode: "service",
      checkoutAhead: false,
      status: status("running"),
      log: "",
    };
    render(<CheckoutRebuildCard />);
    expect(screen.getByText("Now")).toBeTruthy();
    expect(screen.getByRole("button", { name: /rebuilding/i })).toBeDisabled();
  });

  it("keeps a failed rebuild's error and still offers another run", () => {
    live.data = {
      available: true,
      mode: "service",
      checkoutAhead: false,
      status: status("failed"),
      log: "",
    };
    render(<CheckoutRebuildCard />);
    expect(screen.getByRole("alert")).toHaveTextContent("npm install failed.");
    expect(screen.getByRole("button", { name: /pull and rebuild/i })).toBeEnabled();
  });

  it.each(["interrupted", "failed"] as const)("keeps Restart DevHub after a later %s run", (state) => {
    desktop.enabled = true;
    live.data = {
      available: true,
      mode: "payload",
      checkoutAhead: true,
      status: { ...status(state), restartRequired: true },
      log: "",
    };
    render(<CheckoutRebuildCard />);
    expect(screen.getByRole("button", { name: "Restart DevHub" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /pull and rebuild/i })).toBeEnabled();
  });
});
