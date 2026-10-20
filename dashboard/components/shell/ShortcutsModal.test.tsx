// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutsModal } from "./ShortcutsModal";

afterEach(cleanup);

function goToRow(action: string) {
  render(<ShortcutsModal open onClose={vi.fn()} />);
  const label = within(screen.getByRole("group", { name: "Go to" })).queryByText(action);
  return label?.parentElement ?? null;
}

describe("ShortcutsModal go-to list", () => {
  it.each([
    ["Settings", ["g", "s"]],
    ["Agent skills", ["g", "k"]],
    ["Tasks", ["g", "t"]],
  ])("names %s by its new label on the same keys", (action, keys) => {
    const row = goToRow(action);
    expect(row).not.toBeNull();
    expect([...row!.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(keys);
  });

  it("no longer lists the old Status and Skills labels", () => {
    render(<ShortcutsModal open onClose={vi.fn()} />);
    const list = within(screen.getByRole("group", { name: "Go to" }));
    expect(list.queryByText("Status")).toBeNull();
    expect(list.queryByText("Skills")).toBeNull();
  });
});
