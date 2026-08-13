/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "./ToastProvider";
import { useToast } from "@/lib/hooks/use-toast";

/**
 * The Git workspace is a modal `<dialog>`, which paints in the browser's *top
 * layer*. A toast that stays in the normal layer is invisible behind it however
 * high its z-index — which is what made a failing push look like a dead button.
 * These tests pin the popover promotion that fixes it.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** jsdom ships no popover implementation, so install a minimal stand-in. */
function stubPopoverApi() {
  const calls = { show: 0, hide: 0 };
  const proto = HTMLElement.prototype as HTMLElement & {
    showPopover?: () => void;
    hidePopover?: () => void;
  };
  const realMatches = proto.matches;
  Object.defineProperty(proto, "showPopover", {
    configurable: true,
    value(this: HTMLElement) {
      calls.show += 1;
      this.setAttribute("data-popover-open", "true");
    },
  });
  Object.defineProperty(proto, "hidePopover", {
    configurable: true,
    value(this: HTMLElement) {
      calls.hide += 1;
      this.removeAttribute("data-popover-open");
    },
  });
  vi.spyOn(proto, "matches").mockImplementation(function (this: HTMLElement, selector: string) {
    if (selector === ":popover-open") return this.hasAttribute("data-popover-open");
    return realMatches.call(this, selector);
  });
  return {
    calls,
    restore() {
      delete (proto as { showPopover?: unknown }).showPopover;
      delete (proto as { hidePopover?: unknown }).hidePopover;
      vi.restoreAllMocks();
    },
  };
}

function renderWithToast() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let api: ReturnType<typeof useToast> | null = null;

  function Probe() {
    api = useToast();
    return null;
  }

  act(() => {
    root.render(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
    );
  });

  return {
    toast: () => api!,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("ToastProvider top-layer promotion", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("marks the stack as a popover so a modal <dialog> cannot bury it", () => {
    const popover = stubPopoverApi();
    const { toast, cleanup } = renderWithToast();

    const stack = document.querySelector(".toast-stack");
    expect(stack?.getAttribute("popover")).toBe("manual");
    // Nothing to show yet — an empty stack should not enter the top layer.
    expect(popover.calls.show).toBe(0);

    act(() => {
      toast().error("Push rejected");
    });
    expect(popover.calls.show).toBe(1);
    expect(document.querySelector(".toast-message")?.textContent).toBe("Push rejected");

    cleanup();
    popover.restore();
  });

  it("still renders the toast when the browser has no popover support", () => {
    const { toast, cleanup } = renderWithToast();

    expect(() => {
      act(() => {
        toast().success("Pushed");
      });
    }).not.toThrow();
    expect(document.querySelector(".toast-message")?.textContent).toBe("Pushed");

    cleanup();
  });
});
