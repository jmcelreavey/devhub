/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  collectTagMenuRefs,
  tagMenuCountLabel,
  useTagMenuGroup,
  type UseTagMenuGroupParams,
} from "@/lib/hooks/use-tag-menu";

vi.mock("@/lib/hooks/use-fetch", () => ({
  useLive: (key: string | null) => {
    if (key?.includes("kind=note")) {
      return {
        data: {
          related: [{ kind: "note", id: "task-notes/x", label: "Note" }],
        },
      };
    }
    return { data: undefined };
  },
}));

vi.mock("@/components/shell/TagsModal", () => ({
  TagsModal: ({
    open,
    refs,
  }: {
    open: boolean;
    refs: { kind: string; id: string; label?: string }[];
  }) => {
    if (!open) return null;
    return (
      <div data-testid="tags-modal">
        {refs.length === 0 ? (
          <p>Nothing tagged yet.</p>
        ) : (
          <ul>
            {refs.map((ref) => (
              <li key={`${ref.kind}:${ref.id}`}>{ref.label ?? ref.id}</li>
            ))}
          </ul>
        )}
      </div>
    );
  },
}));

function TagMenuHarness(props: UseTagMenuGroupParams) {
  const { group, modal } = useTagMenuGroup(props);
  const item = group.items[0];
  return (
    <div>
      <span data-testid="count">{item.description}</span>
      <button type="button" onClick={() => item.onSelect()}>
        View tags
      </button>
      {modal}
    </div>
  );
}

describe("collectTagMenuRefs", () => {
  it("is the source of truth for both the menu count and the modal list", () => {
    const refs = collectTagMenuRefs(["job-scout"], [
      { kind: "note", id: "task-notes/x", label: "Note" },
    ]);
    expect(tagMenuCountLabel(refs.length)).toBe("2 linked");
    expect(refs.map((ref) => `${ref.kind}:${ref.id}`)).toEqual([
      "tag:job-scout",
      "note:task-notes/x",
    ]);
  });

  it("labels an empty list the same way the menu and modal do", () => {
    expect(tagMenuCountLabel(collectTagMenuRefs(undefined, undefined).length)).toBe("No tags yet");
  });
});

describe("useTagMenuGroup", () => {
  it("keeps extraTags in the modal after the chip menu target is cleared", () => {
    const live: UseTagMenuGroupParams = {
      kind: null,
      id: "job-scout",
      label: "#job-scout",
      extraTags: ["job-scout"],
      enabled: true,
    };
    const { rerender } = render(<TagMenuHarness {...live} />);
    expect(screen.getByTestId("count")).toHaveTextContent("1 linked");

    fireEvent.click(screen.getByRole("button", { name: "View tags" }));
    expect(screen.getByTestId("tags-modal")).toHaveTextContent("#job-scout");

    // ContextMenu onClose + chipTarget=null, same click as onSelect.
    rerender(<TagMenuHarness kind={null} id="" enabled={false} />);
    expect(screen.getByTestId("count")).toHaveTextContent("1 linked");
    expect(screen.queryByText("Nothing tagged yet.")).not.toBeInTheDocument();
    expect(screen.getByTestId("tags-modal")).toHaveTextContent("#job-scout");
  });

  it("keeps the entity-links fetch identity after kind/id drop", () => {
    const { rerender } = render(
      <TagMenuHarness kind="note" id="meetings/standup" label="Standup" enabled />,
    );
    expect(screen.getByTestId("count")).toHaveTextContent("1 linked");

    fireEvent.click(screen.getByRole("button", { name: "View tags" }));
    expect(screen.getByTestId("tags-modal")).toHaveTextContent("Note");

    rerender(<TagMenuHarness kind={null} id="" enabled={false} />);
    expect(screen.getByTestId("count")).toHaveTextContent("1 linked");
    expect(screen.queryByText("Nothing tagged yet.")).not.toBeInTheDocument();
    expect(screen.getByTestId("tags-modal")).toHaveTextContent("Note");
  });
});
