// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ propose: vi.fn() }));
vi.mock("@/lib/terminal-inject", () => ({ proposeTerminalRun: mocks.propose }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ error: vi.fn(), info: vi.fn() }) }));
import { ProviderError } from "./ProviderError";

beforeEach(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("ProviderError", () => {
  it("offers Sign in to Cursor, in the dialog as well as on the card", () => {
    render(<ProviderError provider="Cursor" error="Authentication required. Please run 'agent login'" />);
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const buttons = screen.getAllByRole("button", { name: "Sign in to Cursor" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(mocks.propose).toHaveBeenCalledWith(expect.objectContaining({ command: "agent login" }));
  });
  it("collapses the raw log with ANSI stripped, behind a labelled copy button", () => {
    const { container } = render(<ProviderError provider="OpenCode" error={"\u001b[91m\u001b[1mError: \u001b[0mConfiguration is invalid\n↳ Invalid input mcp.devhub"} />);
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const log = container.querySelector("details");
    expect(log?.open).toBe(false);
    expect(log?.querySelector("pre")?.textContent).toBe("Error: Configuration is invalid\n↳ Invalid input mcp.devhub");
    expect(screen.getByRole("button", { name: /Copy raw log/ })).toBeTruthy();
  });
  it("repairs the DevHub MCP entry from a button and says what to do next", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, restartRequired: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onRepaired = vi.fn();
    render(<ProviderError provider="OpenCode" error="Invalid input mcp.devhub" onRepaired={onRepaired} />);
    fireEvent.click(screen.getByRole("button", { name: "Repair DevHub MCP entry" }));
    await waitFor(() => expect(onRepaired).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ action: "repair-opencode-mcp" });
    expect((await screen.findAllByText(/Restart Paseo/))[0]).toBeTruthy();
  });
  it("shows a failed repair instead of swallowing it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Could not repair." }, { status: 400 })));
    render(<ProviderError provider="OpenCode" error="Invalid input mcp.devhub" />);
    fireEvent.click(screen.getByRole("button", { name: "Repair DevHub MCP entry" }));
    expect((await screen.findAllByText("Could not repair.")).length > 0).toBe(true);
  });
});
