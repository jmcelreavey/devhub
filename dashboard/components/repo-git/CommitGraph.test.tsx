/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { layoutCommitGraph } from "@/lib/repos/git-graph";
import type { GraphCommitRaw } from "@/lib/repos/git-parsers";
import { CommitGraph } from "./CommitGraph";

beforeEach(() => {
  vi.stubGlobal("crypto", {
    subtle: {
      digest: async () => new Uint8Array(32).fill(0xab).buffer,
    },
  });
});

function raw(email: string): GraphCommitRaw {
  return {
    hash: "166e9020b57b9fab2e9102b8afa9abb4934c0780",
    shortHash: "166e902",
    parents: [],
    subject: "PTF-4546",
    author: "JustinFerrara",
    authorEmail: email,
    relativeDate: "15 hours ago",
    refs: [],
    isHead: false,
    headBranch: null,
  };
}

describe("CommitGraph avatars", () => {
  it("passes the identity avatar URL into the row thumbnail", async () => {
    // `git log` preserves the case the author committed under; the identity
    // index is lowercased. Matching those is the whole point of the lookup.
    const commits = layoutCommitGraph([raw("Justin.P.Ferrara@GMAIL.com")]);
    render(
      <CommitGraph
        commits={commits}
        identityByEmail={{
          "justin.p.ferrara@gmail.com": {
            avatarUrl: "https://avatars.githubusercontent.com/u/14058449?v=4",
            displayName: "JustinFerrara",
          },
        }}
      />,
    );
    await waitFor(() => {
      const img = document.querySelector<HTMLImageElement>(".repo-git-avatar-img");
      expect(img?.src).toContain("avatars.githubusercontent.com/u/14058449");
    });
  });

  it("puts the kebab on the row container, not as the only contextmenu target", async () => {
    const onKebabOpen = vi.fn();
    const commits = layoutCommitGraph([raw("dev@example.com")]);
    render(<CommitGraph commits={commits} onKebabOpen={onKebabOpen} />);

    const row = document.querySelector(".repo-git-graph-row");
    expect(row).toBeTruthy();
    expect(row?.querySelector("[aria-label='Actions for 166e902']")).toBeTruthy();

    fireEvent.contextMenu(row!, { clientX: 24, clientY: 48 });
    // bindRow is optional here — the kebab is what History wires through onKebabOpen.
    fireEvent.click(screen.getByRole("button", { name: "Actions for 166e902" }));
    expect(onKebabOpen).toHaveBeenCalled();
  });
});

describe("CommitGraph WIP row", () => {
  it("pins a WIP row above HEAD and opens Changes on click", async () => {
    const onOpenWip = vi.fn();
    const commits = layoutCommitGraph([raw("dev@example.com")]);
    render(
      <CommitGraph
        commits={commits}
        wip={{ staged: 2, unstaged: 1 }}
        onOpenWip={onOpenWip}
      />,
    );
    const wip = document.querySelector<HTMLElement>(".repo-git-wip-row");
    expect(wip).toBeTruthy();
    expect(wip!.textContent).toContain("3 changed file");
    fireEvent.click(wip!);
    expect(onOpenWip).toHaveBeenCalledTimes(1);
    // The commit rows still render below it.
    expect(document.querySelectorAll(".repo-git-graph-row:not(.repo-git-wip-row)").length).toBe(1);
  });

  it("hides the WIP row when the tree is clean (wip null)", () => {
    const commits = layoutCommitGraph([raw("dev@example.com")]);
    render(<CommitGraph commits={commits} />);
    expect(document.querySelector(".repo-git-wip-row")).toBeNull();
  });
});
