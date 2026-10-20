/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL_TIERS } from "@/lib/storyboard/model-tiers-shared";
import { StartAutoDialog } from "./StartAutoDialog";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);

describe("StartAutoDialog", () => {
  it("starts on the saved tiers by default and offers to save only a change", () => {
    const onStart = vi.fn();
    render(<StartAutoDialog open settings={DEFAULT_MODEL_TIERS} busy={false} onClose={() => undefined} onStart={onStart} />);
    const save = screen.getByRole("checkbox", { name: /Save these as my defaults/ });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Start on auto" }));
    expect(onStart).toHaveBeenLastCalledWith(DEFAULT_MODEL_TIERS, false, true);

    expect(screen.getByRole("checkbox", { name: "Pause after planning" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Pause after planning" }));
    fireEvent.click(screen.getByRole("button", { name: "Start on auto" }));
    expect(onStart).toHaveBeenLastCalledWith(DEFAULT_MODEL_TIERS, false, false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Pause after planning" }));

    fireEvent.change(screen.getByRole("combobox", { name: "Implement" }), { target: { value: "heavy" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    fireEvent.click(screen.getByRole("button", { name: "Start on auto" }));
    expect(onStart).toHaveBeenLastCalledWith({ ...DEFAULT_MODEL_TIERS, steps: { ...DEFAULT_MODEL_TIERS.steps, implement: "heavy" } }, true, true);
  });
});
