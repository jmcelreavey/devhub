/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntityLinkDialog } from "@/components/EntityLinkDialog";
import type { ReposApiPayload } from "@/app/repos/types";
import type { EntityRef } from "@/lib/entity-note";

const payloads = new Map<string, unknown>();

vi.mock("@/components/shell/ModalShell", () => ({
  ModalShell: ({
    open,
    children,
    footer,
  }: {
    open: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) => (open ? <div>{children}{footer}</div> : null),
}));

vi.mock("@/lib/hooks/use-fetch", () => ({
  useLive: (key: string | null) => ({
    data: key ? payloads.get(key) : undefined,
    error: undefined,
    isLoading: false,
  }),
}));

function repoPayload(): ReposApiPayload {
  return {
    scanDirDisplay: "~/Developer",
    repos: [
      { name: "app-poc", path: "/repos/app-poc", branch: "main", dirtyCount: 0, remote: null },
      { name: "devhub-private", path: "/repos/devhub-private", branch: "feat", dirtyCount: 0, remote: null },
      { name: "openchamber", path: "/repos/openchamber", branch: "main", dirtyCount: 0, remote: null },
    ],
  };
}

function renderDialog(opts?: {
  existing?: EntityRef[];
  onSave?: (refs: EntityRef[]) => Promise<void>;
  onClose?: () => void;
}) {
  const onSave = vi.fn(opts?.onSave ?? (async () => {}));
  const onClose = vi.fn(opts?.onClose ?? (() => {}));
  render(
    <EntityLinkDialog
      open
      onClose={onClose}
      onSave={onSave}
      defaultKind="repo"
      existing={opts?.existing}
    />,
  );
  return { onSave, onClose };
}

beforeEach(() => {
  payloads.clear();
  payloads.set("/api/repos", repoPayload());
});

afterEach(cleanup);

describe("EntityLinkDialog multiselect", () => {
  it("disables Add link until something is selected", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Add link" })).toBeDisabled();
  });

  it("adds a link for each selected row", async () => {
    const { onSave, onClose } = renderDialog();
    fireEvent.click(screen.getByRole("option", { name: /app-poc/ }));
    fireEvent.click(screen.getByRole("option", { name: /openchamber/ }));
    expect(screen.getByText("Selected: 2 · app-poc, openchamber")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add 2 links" }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith([
        expect.objectContaining({ kind: "repo", id: "app-poc" }),
        expect.objectContaining({ kind: "repo", id: "openchamber" }),
      ]);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("skips rows that are already linked", async () => {
    const { onSave } = renderDialog({
      existing: [{ kind: "repo", id: "app-poc", label: "app-poc" }],
    });
    fireEvent.click(screen.getByRole("option", { name: /app-poc/ }));
    fireEvent.click(screen.getByRole("option", { name: /openchamber/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add 2 links" }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith([
        expect.objectContaining({ kind: "repo", id: "openchamber" }),
      ]);
    });
  });

  it("reports when every selected row is already linked", async () => {
    const { onSave, onClose } = renderDialog({
      existing: [{ kind: "repo", id: "app-poc", label: "app-poc" }],
    });
    fireEvent.click(screen.getByRole("option", { name: /app-poc/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Already linked.");
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shift-click selects a range of rows", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("option", { name: /app-poc/ }));
    fireEvent.click(screen.getByRole("option", { name: /openchamber/ }), { shiftKey: true });
    expect(screen.getByRole("button", { name: "Add 3 links" })).toBeEnabled();
  });
});
