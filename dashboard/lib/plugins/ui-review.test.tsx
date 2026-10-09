/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { PluginsPage } from "../../app/plugins/client";
import { AccessBody, PreviewBody } from "../../app/plugins/views";
import { accessFixture, pluginListFixture, readyOperation } from "./ui-test-fixtures";

const navigation = vi.hoisted(() => ({ query: "operation=a123456789abcdef", replace: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/plugins", useRouter: () => ({ replace: navigation.replace }), useSearchParams: () => new URLSearchParams(navigation.query) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); navigation.query = "operation=a123456789abcdef"; navigation.replace.mockClear(); });

function page() { return render(<SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}><PluginsPage /></SWRConfig>); }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }); }

describe("plugin review interactions", () => {
  it("shows apply progress immediately while confirmation is pending", async () => {
    let release!: (response: Response) => void;
    const operation = readyOperation();
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === "POST") return new Promise<Response>((resolve) => { release = resolve; });
      return json(url === "/api/plugins" ? pluginListFixture : operation);
    }));
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Enable and sync" }));
    expect(await screen.findByRole("heading", { name: "Enabling team-tools" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable and sync" })).not.toBeInTheDocument();
    release(json({ ...operation, state: "succeeded", message: "team-tools is enabled" }));
    expect(await screen.findByRole("heading", { name: "team-tools is enabled" })).toBeInTheDocument();
  });

  it("keeps stale approval errors visible with a review action", async () => {
    const operation = readyOperation();
    let stale = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === "POST") { stale = true; return json({ error: { code: "PREVIEW_STALE", message: "Targets changed. Review again." } }, 409); }
      return json(url === "/api/plugins" ? pluginListFixture : stale ? { ...operation, state: "expired", error: { code: "PREVIEW_STALE", message: "Targets changed. Review again.", retryable: false, consequences: [], paths: [] } } : operation);
    }));
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Enable and sync" }));
    expect(await screen.findByRole("button", { name: "Review again" })).toBeInTheDocument();
    expect(screen.getAllByText("Targets changed. Review again.").length).toBeGreaterThan(0);
  });

  it("focuses Cancel for a destructive confirmation and waits for that decision", async () => {
    const operation = { ...readyOperation(), kind: "remove", steps: [{ id: "sync", label: "Disable future sync", state: "pending" }] };
    const fetcher = vi.fn(async (url: string) => json(url === "/api/plugins" ? pluginListFixture : operation));
    vi.stubGlobal("fetch", fetcher);
    page();
    expect(await screen.findByRole("button", { name: "Remove plugin" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
    expect(fetcher.mock.calls.every((call) => !call[0].endsWith("/confirm"))).toBe(true);
  });

  it("cancels a late preparation response after the Add dialog was closed", async () => {
    navigation.query = "add=1";
    let release!: (response: Response) => void;
    const fetcher = vi.fn(async (url: string) => {
      if (url === "/api/plugins/prepare") return new Promise<Response>((resolve) => { release = resolve; });
      return json(pluginListFixture);
    });
    vi.stubGlobal("fetch", fetcher);
    page();
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "https://github.com/team-tools/examples" } });
    fireEvent.click(screen.getByRole("button", { name: "Review plugin" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    release(json({ operationId: "a123456789abcdef" }));
    await waitFor(() => expect(fetcher.mock.calls.some((call) => call[0].endsWith("/cancel"))).toBe(true));
    expect(navigation.replace).not.toHaveBeenCalledWith(expect.stringContaining("operation="), expect.anything());
  });

  it("offers a retry when loading an operation fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/plugins" ? json(pluginListFixture) : json({ error: { message: "Unavailable" } }, 500)));
    page();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("Escape closes an apply window while progress remains available", async () => {
    const operation = { ...readyOperation(), state: "applying", phase: "Sync skills and agents", cancellable: false };
    const fetcher = vi.fn(async (url: string) => json(url === "/api/plugins" ? pluginListFixture : operation));
    vi.stubGlobal("fetch", fetcher);
    page();
    await screen.findByRole("heading", { name: "Enabling team-tools" });
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
    expect(await screen.findByRole("button", { name: "View progress" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some((call) => call[0].endsWith("/cancel"))).toBe(false);
  });

  it("uses arrow keys for access tabs and labels their panels", () => {
    const change = vi.fn();
    render(<AccessBody access={accessFixture} tab="gh" onTab={change} />);
    const tabs = screen.getAllByRole("tab");
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(tabs[1]).toHaveFocus();
    expect(change).toHaveBeenCalledWith("git");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tabs[0].id);
  });

  it("discloses the source, executable skills and agents in a mixed blocked plugin", () => {
    const operation = readyOperation();
    const preview = { ...operation.preview!, blockers: [{ code: "UNSUPPORTED", message: "MCP servers cannot be applied" }], canApply: false };
    render(<PreviewBody operation={operation} preview={preview} selected={[]} onSelect={() => undefined} syncHeading="Sync to" syncNote={null} runtimeLabel="This computer" />);
    expect(screen.getByText(/https:\/\/github.com\/team-tools\/examples ·/)).toBeInTheDocument();
    expect(screen.getByText(/includes executable files/)).toBeInTheDocument();
    expect(screen.getByText(/readonly: true/)).toBeInTheDocument();
  });
});
