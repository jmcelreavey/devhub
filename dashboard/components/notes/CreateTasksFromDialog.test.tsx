/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CreateTasksFromDialog } from "./CreateTasksFromDialog";

vi.mock("@/components/shell/ModalShell", () => ({
  ModalShell: ({ open, children, footer }: { open: boolean; children: ReactNode; footer: ReactNode }) =>
    open ? <div>{children}{footer}</div> : null,
}));
vi.mock("@/components/tasks/SkillAgentDialog", () => ({
  SkillAgentDialog: ({ open, onClose, onLaunched, getPrompt }: { open: boolean; onClose: () => void; onLaunched: () => void; getPrompt: () => string }) =>
    open ? <div><pre data-testid="agent-prompt">{getPrompt()}</pre><button onClick={onClose}>Back to review</button><button onClick={onLaunched}>Simulate launch success</button></div> : null,
}));

const preview = {
  title: "Android testing",
  workItems: [
    { id: "item-1", title: "icon chopped", summary: "Android splash icon is cropped", description: "Splash screen reproduction details." },
    { id: "item-2", title: "feedback blank", summary: "Send feedback opens a blank screen", description: "Feedback reproduction details." },
  ],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => preview }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CreateTasksFromDialog", () => {
  it("closes the whole flow after a successful launch", async () => {
    const onClose = vi.fn();
    render(<CreateTasksFromDialog open notePath="task-notes/android" onClose={onClose} />);
    await screen.findByLabelText("Ticket 1 title");
    fireEvent.click(screen.getByRole("button", { name: "Launch agent…" }));
    fireEvent.click(screen.getByRole("button", { name: "Simulate launch success" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("hands off only reviewed items and keeps edits when returning from agent selection", async () => {
    render(<CreateTasksFromDialog open notePath="task-notes/android" onClose={vi.fn()} />);
    const title = await screen.findByLabelText("Ticket 1 title");
    expect((title as HTMLInputElement).value).toBe("Android splash icon is cropped");
    fireEvent.change(title, { target: { value: "Fix the cropped splash icon" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove ticket 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Launch agent…" }));

    const prompt = screen.getByTestId("agent-prompt").textContent;
    expect(prompt).toContain("Fix the cropped splash icon");
    expect(prompt).toContain("Splash screen reproduction details.");
    expect(prompt).not.toContain("feedback");
    fireEvent.click(screen.getByRole("button", { name: "Back to review" }));
    expect((screen.getByLabelText("Ticket 1 title") as HTMLInputElement).value).toBe("Fix the cropped splash icon");
    expect(screen.queryByLabelText("Ticket 2 title")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("blocks launch for empty titles and when every item is removed", async () => {
    render(<CreateTasksFromDialog open notePath="task-notes/android" onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Ticket 1 title"), { target: { value: " " } });
    expect((screen.getByRole("button", { name: "Launch agent…" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove ticket 1" }));
    expect((screen.getByRole("button", { name: "Launch agent…" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Remove ticket 1" }));
    expect(screen.getByText("All work items removed. No tickets will be created.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Launch agent…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lets the user review original titles after a generation failure", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ...preview, warning: "Work items detected, but AI title refinement timed out. Showing titles taken from the note; you can edit them below." }),
    } as Response);
    render(<CreateTasksFromDialog open notePath="task-notes/android" onClose={vi.fn()} />);
    expect(await screen.findByText(/Work items detected, but AI title refinement timed out/)).toBeTruthy();
    expect(screen.getByLabelText("Ticket 1 title")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Launch agent…" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
