/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphiteCursorFollower } from "./GraphiteCursorFollower";

let frames: Map<number, FrameRequestCallback>;
let time: number;
let fine: boolean;
let mediaChange: () => void;

function pointer(target: Element | Window, type = "pointermove", init: MouseEventInit = {}, pointerType = "mouse") {
  const event = new MouseEvent(type, { bubbles: true, clientX: 100, clientY: 100, ...init });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  target.dispatchEvent(event);
}

function advance(count = 1) {
  for (let i = 0; i < count; i++) {
    time += 16;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(time));
  }
}

function mount() {
  const { container, unmount } = render(<GraphiteCursorFollower />);
  const ring = container.querySelector<HTMLDivElement>(".graphite-cursor-follower")!;
  return { ring, unmount };
}

describe("Graphite cursor follower", () => {
  beforeEach(() => {
    frames = new Map();
    time = 0;
    fine = true;
    let id = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (frame: number) => frames.delete(frame));
    window.matchMedia = vi.fn().mockImplementation(() => ({
      get matches() { return fine; },
      addEventListener: (_event: string, listener: () => void) => { mediaChange = listener; },
      removeEventListener: vi.fn(),
    }));
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("starts at the pointer, eases behind it with one frame, then sleeps", () => {
    const { ring } = mount();
    expect(ring.hidden).toBe(true);
    pointer(document.body);
    expect(ring.hidden).toBe(false);
    expect(ring.style.transform).toContain("translate3d(100px, 100px");
    for (let x = 101; x <= 200; x++) pointer(document.body, "pointermove", { clientX: x });
    expect(frames.size).toBe(1);
    advance();
    const x = Number(ring.style.transform.match(/translate3d\(([\d.]+)px/)![1]);
    expect(x).toBeGreaterThan(100);
    expect(x).toBeLessThan(200);
    advance(60);
    expect(ring.style.transform).toContain("translate3d(200px, 100px");
    expect(frames.size).toBe(0);
  });

  it("grows and fills over nested controls, shrinks on press and ignores disabled controls", () => {
    const { ring } = mount();
    const button = document.createElement("button");
    const icon = document.createElement("span");
    button.append(icon);
    document.body.append(button);
    pointer(document.body);
    pointer(icon, "pointerover");
    advance(40);
    expect(ring.style.transform).toContain("scale(1.3)");
    expect(ring.firstElementChild?.getAttribute("style")).toContain("scale(1)");
    pointer(icon, "pointerdown", { buttons: 1 });
    advance(40);
    expect(ring.style.transform).toContain("scale(0.76)");
    pointer(icon, "pointerup");
    advance(40);
    expect(ring.style.transform).toContain("scale(1.3)");
    button.disabled = true;
    pointer(icon);
    advance(40);
    expect(ring.style.transform).toContain("scale(1)");
    expect(ring.firstElementChild?.getAttribute("style")).toContain("scale(0)");
  });

  it.each(["input", "textarea", "[contenteditable]", ".cm-editor", ".xterm", ".terminal-dock", ".terminal-blocks-view"])(
    "hides over %s and re-enters without crossing from the old position", selector => {
      const { ring } = mount();
      const surface = document.createElement(selector === "input" || selector === "textarea" ? selector : "div");
      if (selector.startsWith(".")) surface.className = selector.slice(1);
      if (selector === "[contenteditable]") surface.setAttribute("contenteditable", "true");
      const child = document.createElement("span");
      if (surface.tagName === "DIV") surface.append(child);
      document.body.append(surface);
      pointer(document.body);
      pointer(surface.tagName === "DIV" ? child : surface);
      expect(ring.hidden).toBe(true);
      expect(frames.size).toBe(0);
      pointer(document.body, "pointermove", { clientX: 700 });
      expect(ring.style.transform).toContain("translate3d(700px");
    },
  );

  it("hides on exit, blur, scrolling, keyboard navigation, cancellation and hidden tabs", () => {
    const { ring } = mount();
    const exits = [
      () => pointer(window, "pointerout", { relatedTarget: null }),
      () => window.dispatchEvent(new Event("blur")),
      () => document.dispatchEvent(new Event("scroll", { bubbles: true })),
      () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" })),
      () => window.dispatchEvent(new Event("pointercancel")),
      () => document.dispatchEvent(new Event("visibilitychange")),
    ];
    for (const exit of exits) {
      pointer(document.body);
      expect(ring.hidden).toBe(false);
      exit();
      expect(ring.hidden).toBe(true);
      expect(frames.size).toBe(0);
    }
  });

  it("never follows touch or coarse pointers and cancels work on unmount", () => {
    const { ring, unmount } = mount();
    pointer(document.body, "pointermove", {}, "touch");
    expect(ring.hidden).toBe(true);
    fine = false;
    pointer(document.body);
    expect(ring.hidden).toBe(true);
    fine = true;
    pointer(document.body);
    expect(ring.hidden).toBe(false);
    fine = false;
    mediaChange();
    expect(ring.hidden).toBe(true);
    fine = true;
    pointer(document.body);
    unmount();
    expect(frames.size).toBe(0);
    pointer(document.body);
    expect(frames.size).toBe(0);
  });
});
