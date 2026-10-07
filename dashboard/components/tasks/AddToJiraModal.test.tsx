/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AddToJiraModal } from "./AddToJiraModal";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), success: vi.fn(), error: vi.fn(), mutate: vi.fn(),
  metaLoading: false,
}));
vi.mock("swr", () => ({ mutate: mocks.mutate }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));
vi.mock("@/lib/hooks/use-fetch", () => ({
  useLive: (key: string | null) => ({
    data: key?.startsWith("/api/jira/ticket/") ? parent : meta,
    isLoading: key?.startsWith("/api/jira/meta") && mocks.metaLoading,
    mutate: mocks.mutate,
  }),
}));
vi.mock("@/components/shell/ModalShell", () => ({
  ModalShell: ({ children, footer, title }: { children: ReactNode; footer: ReactNode; title: string }) => (
    <section role="dialog" aria-label={title}>{children}{footer}</section>
  ),
}));
vi.mock("@/components/ui/RichTextField", () => ({
  RichTextField: ({ initialMarkdown, onChangeMarkdown }: { initialMarkdown?: string; onChangeMarkdown: (text: string) => void }) => (
    <textarea aria-label="Description" defaultValue={initialMarkdown} onChange={(event) => onChangeMarkdown(event.target.value)} />
  ),
}));
vi.mock("@/components/jira/JiraKeyChip", () => ({ JiraKeyChip: ({ jiraKey }: { jiraKey: string }) => <span>{jiraKey}</span> }));

const task = {
  id: "task-1", text: "TEST-7 Fix renewal events", jiraKey: "TEST-7",
  done: false, createdAt: "2026-10-01T12:00:00Z",
};
const parent = { key: "TEST-7", summary: "Renewals", issuetype: "Sub-task", parent: { key: "TEST-1", summary: "Subscriptions", issuetype: "Story" } };
const meta = { configured: true, sprint: { id: 12, name: "Sprint 12" }, me: { displayName: "Developer" }, teamLabel: "Team" };
const draft = { summary: "Handle renewal events in order", description: "Keep the most recent subscription state.", warnings: [] };
const props = { open: true, task, date: "2026-10-01", onClose: vi.fn(), onCreated: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.metaLoading = false;
  mocks.fetch.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => url === "/api/jira/draft" ? draft : { key: "TEST-8", url: "https://jira.example/browse/TEST-8" },
  }));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows the generated draft, accepts edits and creates only after the user clicks", async () => {
  render(<AddToJiraModal {...props} generateOnOpen />);
  await waitFor(() => expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(draft.summary));
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.fetch.mock.calls[0]![0]).toBe("/api/jira/draft");
  expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body)).toEqual({ taskId: task.id, date: props.date });

  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "My revised title" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "My revised description" } });
  fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
  await waitFor(() => expect(props.onCreated).toHaveBeenCalledWith("TEST-8", "https://jira.example/browse/TEST-8"));
  expect(mocks.fetch.mock.calls[1]![0]).toBe("/api/jira/issue");
  expect(JSON.parse(mocks.fetch.mock.calls[1]![1].body)).toEqual({
    projectKey: "TEST", summary: "My revised title", description: "My revised description",
    parentKey: "TEST-1", assignToMe: true, sprintId: 12,
  });
});

it("cancels generation when the review form closes", async () => {
  mocks.fetch.mockImplementation(() => new Promise(() => {}));
  const view = render(<AddToJiraModal {...props} generateOnOpen />);
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
  const signal = mocks.fetch.mock.calls[0]![1].signal as AbortSignal;
  expect((screen.getByRole("button", { name: "Create ticket" }) as HTMLButtonElement).disabled).toBe(true);
  view.unmount();
  expect(signal.aborted).toBe(true);
  expect(props.onCreated).not.toHaveBeenCalled();
});

it("keeps manually edited fields when generation fails, then allows a retry", async () => {
  mocks.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Draft failed" }) });
  render(<AddToJiraModal {...props} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Keep this title" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "Keep these details" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await screen.findByText("Draft failed");
  expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Keep this title");
  expect((screen.getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("Keep these details");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(draft.summary));
  expect(mocks.fetch.mock.calls.every(([url]) => url === "/api/jira/draft")).toBe(true);
});

it("waits for Jira metadata before allowing the reviewed ticket to be created", async () => {
  mocks.metaLoading = true;
  const view = render(<AddToJiraModal {...props} generateOnOpen />);
  await waitFor(() => expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(draft.summary));
  expect((screen.getByRole("button", { name: "Create ticket" }) as HTMLButtonElement).disabled).toBe(true);
  mocks.metaLoading = false;
  view.rerender(<AddToJiraModal {...props} generateOnOpen />);
  expect((screen.getByRole("button", { name: "Create ticket" }) as HTMLButtonElement).disabled).toBe(false);
});

it("makes unavailable reference material visible in the review", async () => {
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ ...draft, warnings: ["Couldn't read Jira ticket TEST-1."] }) });
  render(<AddToJiraModal {...props} generateOnOpen />);
  await screen.findByText(/Couldn't read Jira ticket TEST-1/);
  expect(props.onCreated).not.toHaveBeenCalled();
});
