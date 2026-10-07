/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuleCard } from "./RuleCard";
import type { RuleView } from "./api";

afterEach(cleanup);

const rule: RuleView = {
  id: "r_test", text: "Put each route handler in its own file",
  category: "structure", status: "suggested", origin: "review", active: false,
  evidence: [], prs: [42], firstSeen: "2026-10-06T00:00:00Z", lastSeen: "2026-10-06T00:00:00Z",
};

describe("RuleCard editing", () => {
  it("moves focus into the editor and returns it on cancel", () => {
    render(<RuleCard rule={rule} busy={false} onAction={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Rule text" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit" }));
  });

  it("explains invalid rule text and links the message to its field", () => {
    render(<RuleCard rule={rule} busy={false} onAction={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const field = screen.getByRole("textbox", { name: "Rule text" });
    fireEvent.change(field, { target: { value: "x".repeat(265) } });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(field.getAttribute("aria-describedby") ?? "")?.textContent).toContain("Use 8–240 characters; this rule has 265.");
    expect(screen.getByRole("button", { name: "Save and accept" })).toHaveProperty("disabled", true);
    fireEvent.change(field, { target: { value: rule.text } });
    expect(field.getAttribute("aria-invalid")).toBe("false");
    expect(screen.getByRole("button", { name: "Save and accept" })).toHaveProperty("disabled", false);
  });

  it("keeps the draft open when the server rejects the save", async () => {
    const onAction = vi.fn().mockResolvedValue(false);
    render(<RuleCard rule={rule} busy={false} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Rule text" }), { target: { value: "Keep each handler in its own module" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and accept" }));
    await waitFor(() => expect(onAction).toHaveBeenCalled());
    expect(screen.getByRole("textbox", { name: "Rule text" })).toHaveProperty("value", "Keep each handler in its own module");
  });

  it("closes the editor after a successful save", async () => {
    render(<RuleCard rule={rule} busy={false} onAction={vi.fn().mockResolvedValue(true)} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save and accept" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Rule text" })).toBeNull());
  });

  it("discards cancelled changes when editing again", () => {
    render(<RuleCard rule={rule} busy={false} onAction={vi.fn().mockResolvedValue(true)} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Rule text" }), { target: { value: "Discard this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Rule text" })).toHaveProperty("value", rule.text);
  });
});


describe("automatic decisions and human overrides", () => {
  it("shows the automatic reason and removes an active rule without an approval step", () => {
    const onAction = vi.fn().mockResolvedValue(true);
    render(<RuleCard rule={{ ...rule, status: "accepted", active: true, automaticDecision: { status: "accepted", reason: "Current guidance requires this layout.", at: rule.lastSeen } }} busy={false} onAction={onAction} />);
    expect(screen.getByText("Automatically accepted")).toBeTruthy();
    expect(screen.getByText("Decision: Current guidance requires this layout.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onAction).toHaveBeenCalledWith({ action: "status", ruleId: rule.id, status: "rejected" });
  });

  it("reinstates a rejected candidate directly as active", () => {
    const onAction = vi.fn().mockResolvedValue(true);
    render(<RuleCard rule={{ ...rule, status: "rejected", automaticDecision: { status: "rejected", reason: "This was a one-off request.", at: rule.lastSeen } }} busy={false} onAction={onAction} />);
    expect(screen.getByText("Automatically rejected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reinstate" }));
    expect(onAction).toHaveBeenCalledWith({ action: "status", ruleId: rule.id, status: "accepted" });
  });
});
