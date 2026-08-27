/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityRef } from "@/lib/entity-note";
import { TaskList } from "@/components/tasks/TaskList";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock("@/lib/hooks/use-fetch", () => ({
  useLive: () => ({
    data: { tasks: [] },
    error: undefined,
    isLoading: false,
    mutate: vi.fn(async () => undefined),
  }),
}));

vi.mock("@/components/EntityLinkDialog", () => ({
  EntityLinkDialog: ({
    open,
    onSave,
    onClose,
    defaultKind,
  }: {
    open: boolean;
    onSave: (refs: EntityRef[]) => Promise<void>;
    onClose: () => void;
    defaultKind?: string;
  }) =>
    open ? (
      <div data-testid="entity-link-dialog" data-default-kind={defaultKind}>
        <button
          type="button"
          onClick={() =>
            void onSave([{ kind: "repo", id: "app-poc", label: "app-poc" }]).then(() => onClose())
          }
        >
          Mock add repo
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/tasks/AddToJiraModal", () => ({ AddToJiraModal: () => null }));
vi.mock("@/components/jira/JiraTransitionModal", () => ({ JiraTransitionModal: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "task-1",
        text: "Ship hub",
        done: false,
        createdAt: "2026-08-27T00:00:00.000Z",
        links: [{ kind: "repo", id: "app-poc", label: "app-poc" }],
      }),
      text: async () => "",
    }),
  );
});

describe("TaskList add-task repo association", () => {
  it("attaches a repo in the same motion as create", async () => {
    render(<TaskList />);

    fireEvent.click(screen.getByRole("button", { name: "Associate repo" }));
    expect(screen.getByTestId("entity-link-dialog").getAttribute("data-default-kind")).toBe("repo");

    fireEvent.click(screen.getByRole("button", { name: "Mock add repo" }));
    expect(await screen.findByRole("link", { name: "app-poc" })).toHaveAttribute("href", "/repos/app-poc");

    fireEvent.change(screen.getByRole("textbox", { name: "Add a task" }), {
      target: { value: "Ship hub" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/tasks",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            text: "Ship hub",
            links: [{ kind: "repo", id: "app-poc", label: "app-poc" }],
          }),
        }),
      );
    });
  });
});
