/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TopBarMoreMenu } from "./TopBarMoreMenu";

describe("TopBarMoreMenu", () => {
  it("is a panels menu, not a grab-bag that includes setup", () => {
    render(<TopBarMoreMenu />);
    const trigger = screen.getByRole("button", { name: "Panels" });
    expect(trigger).toHaveAttribute("title", "Panels");
    fireEvent.click(trigger, { detail: 1 });
    expect(screen.getByRole("menu", { name: "Panels" })).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    expect(screen.getByRole("menuitem", { name: /^Notes/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^Today's tasks/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^Diagrams/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /setup/i })).toBeNull();
  });
});
