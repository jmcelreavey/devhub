/** @vitest-environment jsdom */
import { render, waitFor } from "@testing-library/react";
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
});
