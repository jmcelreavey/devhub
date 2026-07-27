/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isDesktop, openInBrowser } from "./bridge";

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("openInBrowser", () => {
  it("uses Tauri's internal bridge for an attached localhost dashboard", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: { invoke },
    });

    expect(isDesktop()).toBe(true);
    await openInBrowser("https://jira.example.test/browse/DEV-42");

    expect(invoke).toHaveBeenNthCalledWith(1, "renderer_log", {
      phase: "bridge:tauri-detect",
      message: "Tauri bridge detected",
      host: "jira.example.test",
    });
    expect(invoke).toHaveBeenCalledWith("plugin:opener|open_url", {
      url: "https://jira.example.test/browse/DEV-42",
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "renderer_log", {
      phase: "bridge:invoke",
      message: "System browser open succeeded",
      host: "jira.example.test",
    });
  });

  it("surfaces an opener failure instead of falling back to a blocked webview popup", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("permission denied"));
    const failure = vi.fn();
    const open = vi.spyOn(window, "open");
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(window, "__TAURI__", {
      configurable: true,
      value: { core: { invoke } },
    });
    window.addEventListener("devhub:external-open-failed", failure);

    await openInBrowser("https://jira.example.test/browse/DEV-42");

    expect(failure).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    window.removeEventListener("devhub:external-open-failed", failure);
  });
});
