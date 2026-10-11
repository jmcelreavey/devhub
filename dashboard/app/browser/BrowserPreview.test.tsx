/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrowserPreview } from "./BrowserPreview";

vi.mock("@/lib/hooks/panel-visibility", () => ({ usePanelVisible: () => true }));
const inputs: Record<string, unknown>[] = [];
beforeEach(() => {
  inputs.length = 0;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 800, height: 500, x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 500, toJSON() {} });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
    const request = JSON.parse(String(options.body));
    if (request.action === "input") { inputs.push(request.input); return Response.json({ ok: true }); }
    return new Response(new ReadableStream({
      start(controller) {
        const timer = setTimeout(() => {
          controller.enqueue(new TextEncoder().encode('event: ready\ndata: {"id":"stream"}\n\nevent: frame\ndata: {"id":"stream","data":"fixture","width":800,"height":500}\n\n'));
        }, 10);
        options.signal?.addEventListener("abort", () => { clearTimeout(timer); controller.close(); }, { once: true });
      },
    }));
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("uses the first click only for takeover, then maps clicks in CSS pixels", async () => {
  const takeover = vi.fn(async () => undefined);
  const props = { sessionId: "session", enabled: true, takeControl: takeover };
  const view = render(<BrowserPreview {...props} human={false} />);
  await screen.findByAltText("Live page in the task browser");
  fireEvent.click(screen.getByRole("application"), { clientX: 60, clientY: 18 });
  expect(takeover).toHaveBeenCalledOnce();
  expect(inputs).toHaveLength(0);
  view.rerender(<BrowserPreview {...props} human />);
  fireEvent.click(screen.getByRole("application"), { clientX: 60, clientY: 18 });
  await waitFor(() => expect(inputs).toContainEqual({ kind: "click", x: 60, y: 18, count: 1 }));
});
it("keeps IME composition local until commit and captures wheel without scrolling DevHub", async () => {
  render(<BrowserPreview sessionId="session" enabled human takeControl={vi.fn()} />);
  await screen.findByAltText("Live page in the task browser");
  const field = screen.getByRole("textbox", { name: "Keyboard and IME input" });
  fireEvent.compositionStart(field);
  fireEvent.input(field, { target: { value: "日本語" } });
  expect(inputs.filter((input) => input.kind === "text")).toHaveLength(0);
  fireEvent.compositionEnd(field, { data: "日本語" });
  await waitFor(() => expect(inputs.filter((input) => input.kind === "text")).toEqual([{ kind: "text", text: "日本語" }]));
  const event = new WheelEvent("wheel", { clientX: 100, clientY: 100, deltaY: 10, deltaMode: 1, cancelable: true, bubbles: true });
  screen.getByRole("application").dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await waitFor(() => expect(inputs).toContainEqual({ kind: "scroll", x: 100, y: 100, deltaX: 0, deltaY: 160 }));
});
it("shows a recoverable connection failure instead of an endless skeleton", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("Offline"));
  render(<BrowserPreview sessionId="session" enabled human takeControl={vi.fn()} />);
  expect(await screen.findByRole("button", { name: "Reconnect live view" })).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("Offline");
});
