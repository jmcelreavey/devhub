/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateBanner } from "./UpdateBanner";

const handlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>());
vi.mock("@/lib/desktop/bridge", () => ({
  isDesktop: () => true,
  onDesktopEvent: async (name: string, handler: (payload: unknown) => void) => {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

let outcome: unknown;
let rebuild: unknown;
let invoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  rebuild = { available: false, checkoutAhead: false };
  invoke = vi.fn(async (cmd: string) => {
    if (cmd === "check_update_outcome") {
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }
    return undefined;
  });
  (window as unknown as { __TAURI__: unknown }).__TAURI__ = { core: { invoke } };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => rebuild }) as Response));
});
afterEach(() => { cleanup(); handlers.clear(); vi.unstubAllGlobals(); delete (window as unknown as { __TAURI__?: unknown }).__TAURI__; });

async function checkFromTray() {
  render(<UpdateBanner />);
  await waitFor(() => expect(handlers.has("devhub://check-updates")).toBe(true));
  await act(async () => { handlers.get("devhub://check-updates")!(undefined); });
}

describe("the tray's Check for Updates always shows a result", () => {
  it("says it is checking, then that you are up to date", async () => {
    outcome = { status: "upToDate", currentVersion: "2.0.0" };
    await checkFromTray();
    expect(await screen.findByText("You're up to date (2.0.0)")).toBeTruthy();
  });
  it("says there is no published release yet, not an error", async () => {
    outcome = { status: "noRelease", currentVersion: "2.0.0" };
    await checkFromTray();
    expect(await screen.findByText("No published release yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  });
  it("offers Install when an update is available", async () => {
    outcome = { status: "available", currentVersion: "2.0.0", version: "2.1.0" };
    await checkFromTray();
    expect(await screen.findByText("DevHub 2.1.0 is available")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Install/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("install_update"));
  });
  it("shows a readable failure with the raw text behind Details, and can retry", async () => {
    outcome = { status: "failed", currentVersion: "2.0.0", message: "Couldn't reach the update server. Check your connection and try again.", details: "dns error: no such host" };
    await checkFromTray();
    expect(await screen.findByText(/Couldn't reach the update server/)).toBeTruthy();
    expect(screen.queryByText("dns error: no such host")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("dns error: no such host")).toBeTruthy();
    outcome = { status: "upToDate", currentVersion: "2.0.0" };
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByText("You're up to date (2.0.0)")).toBeTruthy();
  });
  it("still answers if the check itself cannot run", async () => {
    outcome = new Error("command not allowed");
    await checkFromTray();
    expect(await screen.findByText("The update check could not run.")).toBeTruthy();
  });
  it("offers to rebuild when the user's checkout is ahead of the running build", async () => {
    outcome = { status: "noRelease", currentVersion: "2.0.0" };
    rebuild = { available: true, checkoutAhead: true };
    await checkFromTray();
    const link = await screen.findByRole("link", { name: "Rebuild from my checkout" });
    expect(link.getAttribute("href")).toBe("/status?tab=maintenance&rebuild=1");
    expect(screen.getByText(/Your checkout is ahead of the running build/)).toBeTruthy();
  });
});
