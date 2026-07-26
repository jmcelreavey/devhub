/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GoalPicker } from "@/components/setup/GoalPicker";
import { GOALS } from "@/lib/setup/goals";

describe("GoalPicker", () => {
  it("offers every goal", () => {
    render(<GoalPicker selected={[]} onChange={() => {}} />);
    for (const g of GOALS) {
      expect(screen.getByText(g.label)).toBeTruthy();
    }
  });

  it("reflects the current selection to assistive tech", () => {
    render(<GoalPicker selected={["code"]} onChange={() => {}} />);
    const pressed = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
  });

  it("adds a goal on click", () => {
    const onChange = vi.fn();
    render(<GoalPicker selected={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText("My code"));
    expect(onChange).toHaveBeenCalledWith(["code"]);
  });

  it("removes a goal when clicked again", () => {
    const onChange = vi.fn();
    render(<GoalPicker selected={["code"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("My code"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("accumulates multiple goals", () => {
    const onChange = vi.fn();
    render(<GoalPicker selected={["code"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("Running services"));
    expect(onChange).toHaveBeenCalledWith(["code", "ops"]);
  });

  it("'All of it' replaces the narrower goals rather than stacking with them", () => {
    // It's a shortcut for the union, so holding both states at once would be
    // a contradiction the user can see (two things ticked, one implying the other).
    const onChange = vi.fn();
    render(<GoalPicker selected={["code", "ops"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("All of it"));
    expect(onChange).toHaveBeenCalledWith(["everything"]);
  });

  it("choosing a narrower goal clears 'All of it'", () => {
    const onChange = vi.fn();
    render(<GoalPicker selected={["everything"]} onChange={onChange} />);
    fireEvent.click(screen.getByText("Notes and planning"));
    expect(onChange).toHaveBeenCalledWith(["notes"]);
  });

  it("says the choice is not binding", () => {
    // Anything that looks permanent makes people hesitate over it.
    render(<GoalPicker selected={[]} onChange={() => {}} />);
    expect(screen.getByText(/change it later/i)).toBeTruthy();
  });
});
