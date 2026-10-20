/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddNoteComposer } from "./AddNoteComposer";

const result = { saved: true, note: { id: "n1", text: "Keep API", at: "2026-10-19T10:00:00Z" }, capability: { running: false, auto: false, liveFollowup: false, confirmNeeded: false }, agent: { mode: "none" } };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(running = false, liveFollowup = false, confirmNeeded = false) {
  const capability = { running, liveFollowup, auto: false, confirmNeeded };
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => ({ ok: true, json: async () => options?.method === "POST" ? result : capability }));
  vi.stubGlobal("fetch", fetcher);
  const onCancel = vi.fn(); const onSaved = vi.fn();
  render(<AddNoteComposer taskId="t1" title="Fix API" id="note-t1" capability={capability} onCancel={onCancel} onSaved={onSaved} />);
  return { fetcher, onCancel, onSaved };
}
describe("AddNoteComposer", () => {
  it("lets touch users cancel without a keyboard shortcut or saving", () => {
    const { onCancel, fetcher } = setup();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Unsent context" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
  });
  it("focuses the labelled textarea and Esc cancels without saving", () => {
    const { onCancel, fetcher } = setup();
    const area = screen.getByLabelText("Note for Fix API"); expect(document.activeElement).toBe(area);
    fireEvent.keyDown(area, { key: "Escape" }); expect(onCancel).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(0);
  });
  it.each(["metaKey", "ctrlKey"])("%s + Enter saves, plain Enter does not", async (modifier) => {
    const { fetcher, onSaved } = setup(); const area = screen.getByRole("textbox");
    fireEvent.change(area, { target: { value: "Keep API" } }); fireEvent.keyDown(area, { key: "Enter" });
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.keyDown(area, { key: "Enter", [modifier]: true });
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetcher.mock.calls.find((call) => call[1]?.method === "POST")?.[1]?.body))).toMatchObject({ taskId: "t1", text: "Keep API", updateAgent: false });
  });
  it.each([[false, "Save and update agent"], [true, "Send to agent"]])("shows both running actions (live=%s)", async (live, label) => {
    const { fetcher } = setup(true, live); await screen.findByRole("button", { name: label });
    expect(screen.getByRole("button", { name: "Save note" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep API" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", metaKey: true });
    await waitFor(() => expect(fetcher.mock.calls.some((call) => call[1]?.method === "POST")).toBe(true));
    expect(JSON.parse(String(fetcher.mock.calls.find((call) => call[1]?.method === "POST")?.[1]?.body)).updateAgent).toBe(false);
  });
  it("retains the draft and shows a persistent save error", async () => {
    const { fetcher, onSaved } = setup();
    fetcher.mockImplementationOnce(async () => ({ ok: false, json: async () => ({ error: "Handed off and read-only" }) as never }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep API" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Handed off and read-only");
    expect(screen.getByRole("textbox")).toHaveProperty("value", "Keep API"); expect(onSaved).not.toHaveBeenCalled();
  });
  it("sends update consent only when the primary running action is clicked", async () => {
    const { fetcher, onSaved } = setup(true, true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep API" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to agent" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetcher.mock.calls.find((call) => call[1]?.method === "POST")?.[1]?.body)).updateAgent).toBe(true);
  });
  it("asks before a destructive stop, but never before save-only", async () => {
    const confirm = vi.fn(() => false); vi.stubGlobal("confirm", confirm);
    const { fetcher, onSaved } = setup(true, false, true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep API" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and update agent" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledOnce();
  });
});
