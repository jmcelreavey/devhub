import { afterEach, describe, expect, it, vi } from "vitest";
import { openRepoLinkHref, parseRepoLinkHref } from "@/lib/repos/link";

describe("openRepoLinkHref", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the file path accepted by the repo-open route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await openRepoLinkHref("repo://my-service/src/auth.ts#L42");

    expect(fetchMock).toHaveBeenCalledWith("/api/repos/my-service/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "src/auth.ts" }),
    });
  });
});

describe("parseRepoLinkHref", () => {
  it("parses repo-only links", () => {
    expect(parseRepoLinkHref("repo:devhub")).toEqual({ repoName: "devhub", path: undefined, line: undefined });
  });

  it("parses repo file links with line numbers", () => {
    expect(parseRepoLinkHref("repo:devhub/dashboard/app/page.tsx#L12")).toEqual({
      repoName: "devhub",
      path: "dashboard/app/page.tsx",
      line: 12,
    });
  });

  it("rejects invalid repo names", () => {
    expect(parseRepoLinkHref("repo:../devhub")).toBeNull();
  });
});
