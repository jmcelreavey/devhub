/** @vitest-environment jsdom */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

const html = fs.readFileSync(path.resolve(import.meta.dirname, "../../../desktop/boot/index.html"), "utf8");

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); document.body.innerHTML = ""; Reflect.deleteProperty(window, "__TAURI__"); });

async function loadFailure(installWsl: boolean, installerError?: string) {
  document.body.innerHTML = html;
  const invoke = vi.fn(async (command: string) => {
    if (command === "boot_state") return { state: "failed", error: "WSL is not installed.", logs: [], install_wsl: installWsl };
    if (command === "install_wsl" && installerError) throw new Error(installerError);
    return [];
  });
  Object.defineProperty(window, "__TAURI__", { configurable: true, value: { core: { invoke }, event: { listen: async () => () => {} } } });
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error("Boot module missing");
  new Function(script)();
  await Promise.resolve();
  await Promise.resolve();
  return invoke;
}

describe("Windows first-run support setup", () => {
  it("offers installation only when the shell says it is needed", async () => {
    await loadFailure(false);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Set up Windows support" })).toBeNull();
  });
  it("opens the fixed installer command and explains the restart/account steps", async () => {
    const invoke = await loadFailure(true);
    expect(screen.getByText("Set up DevHub on Windows")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Set up Windows support" }));
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith("install_wsl");
    expect(document.getElementById("detail")?.textContent).toContain("open Ubuntu to create your Linux account");
  });
  it("keeps the action available when the administrator prompt is cancelled", async () => {
    await loadFailure(true, "Permission prompt cancelled");
    fireEvent.click(screen.getByRole("button", { name: "Set up Windows support" }));
    await Promise.resolve();
    expect(document.getElementById("error-message")?.textContent).toContain("Permission prompt cancelled");
    expect(screen.getByRole("button", { name: "Set up Windows support" })).not.toBeDisabled();
  });
});
