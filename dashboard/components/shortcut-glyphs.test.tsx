/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickCaptureModal } from "./tasks/QuickCaptureModal";
import { ShortcutsOverlay } from "./repo-git/ShortcutsOverlay";

vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/shell/ModalShell", () => ({
  ModalShell: ({ children, footer }: { children?: ReactNode; footer?: ReactNode }) => <section>{children}{footer}</section>,
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function onPlatform(userAgent: string) {
  vi.stubGlobal("navigator", { ...navigator, userAgent });
}
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";

describe("shortcut hints follow the device, not a Mac", () => {
  it("Quick capture says Ctrl on Windows", () => {
    onPlatform(WINDOWS);
    const { container } = render(<QuickCaptureModal open onClose={() => {}} />);
    expect(container.textContent).toContain("Ctrl+Shift+C to open · Ctrl+↵ to save");
    expect(container.textContent).not.toContain("⌘");
  });
  it("Quick capture keeps the Mac glyphs on a Mac", () => {
    onPlatform(MAC);
    const { container } = render(<QuickCaptureModal open onClose={() => {}} />);
    expect(container.textContent).toContain("⌘⇧C to open · ⌘↵ to save");
  });
  it("the git shortcuts list shows Ctrl for the find chord on Windows", () => {
    onPlatform(WINDOWS);
    const { container } = render(<ShortcutsOverlay open onClose={() => {}} activeTab="history" />);
    expect(container.textContent).not.toContain("⌘");
    expect(container.textContent).toContain("Ctrl");
  });
});
