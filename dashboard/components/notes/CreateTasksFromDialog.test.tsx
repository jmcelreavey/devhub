/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreateTasksFromDialog } from "./CreateTasksFromDialog";

vi.mock("@/components/tasks/SkillAgentDialog", () => ({
  SkillAgentDialog: ({ open, onClose, onLaunched, getPrompt }: { open: boolean; onClose: () => void; onLaunched: () => void; getPrompt: () => string }) =>
    open ? <div><pre data-testid="agent-prompt">{getPrompt()}</pre><button onClick={onClose}>Back to review</button><button onClick={onLaunched}>Simulate launch success</button></div> : null,
}));

vi.mock("@/lib/hooks/use-fetch", () => ({
  useLive: (key: string | null) => ({
    data: key === "/api/agent-cli"
      ? {
        provider: "cursor-cli",
        resolvedProvider: "cursor-cli",
        cursorModel: "cursor-grok-4.5-high",
        cursorAgentInstalled: true,
        chatgptCliInstalled: true,
        apiConfigured: true,
        models: {
          "cursor-cli": [
            "cursor-grok-4.5-low",
            "cursor-grok-4.5-high",
            "composer-2.5",
            "composer-2.5-fast",
          ],
          "chatgpt-cli": ["gpt-6-sol"],
        },
      }
      : key === "/api/jira/tickets"
      ? { configured: true, tickets: [{ key: "PTF-4891", summary: "Android testing", status: "In progress", url: "https://jira.example/browse/PTF-4891" }] }
      : { repos: [{ name: "App", branch: "main" }, { name: "webapp", branch: "main" }] },
    isLoading: false,
  }),
}));

const preview = {
  title: "Android testing",
  workItems: [
    { id: "item-1", title: "icon chopped", summary: "Android splash icon is cropped", description: "Splash screen reproduction details." },
    { id: "item-2", title: "feedback blank", summary: "Send feedback opens a blank screen", description: "Feedback reproduction details." },
  ],
};

beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function() { this.removeAttribute("open"); };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => preview }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CreateTasksFromDialog", () => {
  it("keeps the review and link pickers open until explicitly dismissed", async () => {
    const onClose = vi.fn();
    render(<CreateTasksFromDialog open notePath="task-notes/android" onClose={onClose} />);
    fireEvent.change(await screen.findByLabelText("Ticket 1 title"), { target: { value: "Keep this title" } });
    const review = screen.getByRole("dialog", { name: "Create tasks from plan" });
    fireEvent.click(review);
    fireEvent(review, new Event("cancel", { cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Ticket 1 title" })).toHaveValue("Keep this title");

    for (const name of ["Choose parent ticket…", "Add repositories…"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      const picker = screen.getByRole("dialog");
      fireEvent.click(picker);
      fireEvent(picker, new Event("cancel", { cancelable: true }));
      expect(screen.getByRole("dialog")).toBe(picker);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    }
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("uses and remembers a separate provider, model and effort for title suggestions", async () => {
    const first = render(<CreateTasksFromDialog open notePath="task-notes/android" onClose={vi.fn()} />);
    await screen.findByLabelText("Ticket 1 title");
    fireEvent.click(screen.getByText("Title suggestion model"));
    fireEvent.change(await screen.findByRole("combobox", { name: /^Suggestion provider/ }), { target: { value: "chatgpt-cli" } });
    fireEvent.change(screen.getByLabelText("Suggestion model"), { target: { value: "gpt-6-sol" } });
    fireEvent.change(screen.getByRole("combobox", { name: /^Suggestion effort/ }), { target: { value: "low" } });
    fireEvent.click(screen.getByRole("button", { name: "Suggest titles" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string)).toMatchObject({
      refineTitles: true, provider: "chatgpt-cli", model: "gpt-6-sol", effort: "low",
    });
    await waitFor(() => expect(localStorage.getItem("devhub:title-suggestions")).toContain("gpt-6-sol"));
    expect(localStorage.getItem("devhub:effort:chatgpt-cli:gpt-6-sol")).toBeNull();
    first.unmount();
    render(<CreateTasksFromDialog open notePath="task-notes/android" onClose={vi.fn()} />);
    await screen.findByLabelText("Ticket 1 title");
    fireEvent.click(screen.getByText("Title suggestion model"));
    expect(await screen.findByLabelText("Suggestion model")).toHaveValue("gpt-6-sol");
    expect(screen.getByRole("combobox", { name: /^Suggestion provider/ })).toHaveValue("chatgpt-cli");
    expect(screen.getByRole("combobox", { name: /^Suggestion effort/ })).toHaveValue("low");
    fireEvent.change(screen.getByRole("combobox", { name: /^Suggestion provider/ }), { target: { value: "cursor-cli" } });
    expect(screen.getByLabelText("Suggestion model")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: /^Suggestion effort/ })).toHaveValue("");
  });

  it("migrates a remembered Cursor model and hides effort when it has no variants", async () => {
    localStorage.setItem("devhub:title-suggestions", JSON.stringify({
      provider: "cursor-cli",
      model: "composer-2.5[effort=medium]",
      effort: "medium",
    }));
    render(<CreateTasksFromDialog open notePath="task-notes/android" onClose={vi.fn()} />);
    await screen.findByLabelText("Ticket 1 title");
    fireEvent.click(screen.getByText("Title suggestion model"));

    await waitFor(() => expect(screen.getByLabelText("Suggestion model")).toHaveValue("composer-2.5"));
    expect(screen.queryByRole("combobox", { name: /^Suggestion effort/ })).toBeNull();
    await waitFor(() => expect(localStorage.getItem("devhub:title-suggestions")).toContain('"model":"composer-2.5"'));
    expect(localStorage.getItem("devhub:title-suggestions")).not.toContain("medium");
  });

  it("closes the whole flow after a successful launch", async () => {
    const onClose = vi.fn();
    render(<CreateTasksFromDialog open notePath="task-notes/android" onClose={onClose} />);
    await screen.findByLabelText("Ticket 1 title");
    fireEvent.click(screen.getByRole("button", { name: "Choose agent…" }));
    fireEvent.click(screen.getByRole("button", { name: "Simulate launch success" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("hands off only reviewed items and keeps edits when returning from agent selection", async () => {
    render(<CreateTasksFromDialog open notePath="task-notes/android" onClose={vi.fn()} />);
    const title = await screen.findByLabelText("Ticket 1 title");
    expect((title as HTMLTextAreaElement).value).toBe("Android splash icon is cropped");
    fireEvent.change(title, { target: { value: "Fix the cropped splash icon" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove ticket 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose agent…" }));

    const prompt = screen.getByTestId("agent-prompt").textContent;
    expect(prompt).toContain("Fix the cropped splash icon");
    expect(prompt).toContain("Splash screen reproduction details.");
    expect(prompt).not.toContain("feedback");
    fireEvent.click(screen.getByRole("button", { name: "Back to review" }));
    expect((screen.getByLabelText("Ticket 1 title") as HTMLTextAreaElement).value).toBe("Fix the cropped splash icon");
    expect(screen.queryByLabelText("Ticket 2 title")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("blocks launch for empty titles and when every item is removed", async () => {
    render(<CreateTasksFromDialog open notePath="task-notes/android" onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Ticket 1 title"), { target: { value: " " } });
    expect((screen.getByRole("button", { name: "Choose agent…" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove ticket 1" }));
    expect((screen.getByRole("button", { name: "Choose agent…" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Remove ticket 1" }));
    expect(screen.getByText("All work items removed. No tickets will be created.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Choose agent…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("allows launch while optional title suggestions are pending", async () => {
    vi.mocked(fetch).mockReturnValueOnce(Promise.resolve({ ok: true, json: async () => preview } as Response))
      .mockReturnValueOnce(new Promise<Response>(() => {}));
    render(<CreateTasksFromDialog open notePath="task-notes/android" onClose={vi.fn()} />);
    await screen.findByLabelText("Ticket 1 title");
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string).refineTitles).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Suggest titles" }));
    expect(screen.getByText("You can edit or launch while suggestions load.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Choose agent…" }) as HTMLButtonElement).disabled).toBe(false);
    const signal = vi.mocked(fetch).mock.calls[1][1]?.signal;
    fireEvent.click(screen.getByRole("button", { name: "Choose agent…" }));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByTestId("agent-prompt").textContent).toContain(preview.workItems[0].summary);
    fireEvent.click(screen.getByRole("button", { name: "Back to review" }));
    expect((screen.getByRole("button", { name: "Suggest titles" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("can stop a slow suggestion request and ignores its late result", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => preview } as Response)
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...preview, workItems: preview.workItems.map((item) => ({ ...item, summary: "New suggestion" })) }),
      } as Response);
    render(<CreateTasksFromDialog open notePath="task-notes/android" onClose={vi.fn()} />);
    await screen.findByLabelText("Ticket 1 title");
    fireEvent.click(screen.getByRole("button", { name: "Suggest titles" }));
    const oldSignal = vi.mocked(fetch).mock.calls[1][1]?.signal;
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(oldSignal?.aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Suggest titles" }));
    await waitFor(() => expect(screen.getByLabelText("Ticket 1 title")).toHaveValue("New suggestion"));
    await act(async () => finish({ ok: true, json: async () => preview } as Response));
    expect(screen.getByLabelText("Ticket 1 title")).toHaveValue("New suggestion");
  });

  it("preserves earlier suggestions when a later request fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => preview } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...preview, workItems: preview.workItems.map((item) => ({ ...item, summary: "Keep this suggestion" })) }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...preview, warning: "AI title suggestions failed. Your current titles are unchanged." }),
      } as Response);
    render(<CreateTasksFromDialog open notePath="task-notes/android" onClose={vi.fn()} />);
    await screen.findByLabelText("Ticket 1 title");
    fireEvent.click(screen.getByRole("button", { name: "Suggest titles" }));
    await waitFor(() => expect(screen.getByLabelText("Ticket 1 title")).toHaveValue("Keep this suggestion"));
    fireEvent.click(screen.getByRole("button", { name: "Suggest titles" }));
    await screen.findByText("AI title suggestions failed. Your current titles are unchanged.");
    expect(screen.getByLabelText("Ticket 1 title")).toHaveValue("Keep this suggestion");
    expect(screen.getByRole("button", { name: "Choose agent…" })).toBeEnabled();
  });

  it("keeps edits and removed items when title suggestions arrive", async () => {
    let finish!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const items = [...preview.workItems, { id: "item-3", title: "Audio", summary: "Original audio title", description: "Audio details" }];
    vi.mocked(fetch).mockReturnValueOnce(Promise.resolve({ ok: true, json: async () => ({ ...preview, workItems: items }) } as Response))
      .mockReturnValueOnce(pending);
    render(<CreateTasksFromDialog open notePath="task-notes/android" onClose={vi.fn()} />);
    await screen.findByLabelText("Ticket 1 title");
    fireEvent.click(screen.getByRole("button", { name: "Suggest titles" }));
    fireEvent.change(screen.getByLabelText("Ticket 1 title"), { target: { value: "Keep my edited title" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove ticket 2" }));
    await act(async () => {
      finish({ ok: true, json: async () => ({ ...preview, workItems: items.map((item) => ({ ...item, summary: `Suggested ${item.id}` })) }) } as Response);
    });
    expect((screen.getByLabelText("Ticket 1 title") as HTMLTextAreaElement).value).toBe("Keep my edited title");
    expect((screen.getByLabelText("Ticket 2 title") as HTMLTextAreaElement).value).toBe("Suggested item-3");
    expect(screen.queryByLabelText("Ticket 3 title")).toBeNull();
  });

  it("looks up Jira and repositories and includes selected links in the handoff", async () => {
    render(<CreateTasksFromDialog open notePath="task-notes/android" onClose={vi.fn()} />);
    await screen.findByLabelText("Ticket 1 title");
    fireEvent.click(screen.getByRole("button", { name: "Choose parent ticket…" }));
    expect(screen.queryByRole("tablist")).toBeNull();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "PTF-4891" } });
    fireEvent.click(screen.getByRole("option", { name: /PTF-4891/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    const parentLink = await screen.findByRole("link", { name: "PTF-4891: Android testing" });
    expect(parentLink.getAttribute("href")).toBe("https://jira.example/browse/PTF-4891");
    fireEvent.click(screen.getByRole("button", { name: "Add repositories…" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "app" } });
    fireEvent.click(screen.getByRole("option", { name: /^App/ }));
    fireEvent.click(screen.getByRole("option", { name: /^webapp/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add 2 links" }));
    await screen.findByRole("link", { name: "App" });
    await screen.findByRole("link", { name: "webapp" });
    fireEvent.click(screen.getByRole("button", { name: "Remove webapp link" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "webapp" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Choose agent…" }));
    expect(screen.getByTestId("agent-prompt").textContent).toContain("Parent Jira key: PTF-4891");
    expect(screen.getByTestId("agent-prompt").textContent).toContain("Repos: App.");
    expect(screen.getByTestId("agent-prompt").textContent).not.toContain("webapp");
  });

  it("lets the user review original titles after a generation failure", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ...preview, warning: "Work items detected, but AI title refinement timed out. Showing titles taken from the note; you can edit them below." }),
    } as Response);
    render(<CreateTasksFromDialog open notePath="task-notes/android" onClose={vi.fn()} />);
    expect(await screen.findByText(/Work items detected, but AI title refinement timed out/)).toBeTruthy();
    expect(screen.getByLabelText("Ticket 1 title")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Choose agent…" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
