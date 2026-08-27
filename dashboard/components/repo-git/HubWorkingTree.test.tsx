/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HubWorkingTree } from "./HubWorkingTree";

function jsonResponse(data: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response);
}

afterEach(cleanup);

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      jsonResponse({
        files: [{ path: "src/hub.ts", status: "M", staged: false, unstaged: true }],
      }),
    ),
  );
});

describe("HubWorkingTree", () => {
  it("stays collapsed by default and opens a file in git when expanded", async () => {
    const onOpenFile = vi.fn();
    render(<HubWorkingTree repoName="atlas" onOpenFile={onOpenFile} />);

    const toggle = await screen.findByRole("button", { name: /local files/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /open src\/hub\.ts in git/i })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const file = await screen.findByRole("button", { name: /open src\/hub\.ts in git/i });
    fireEvent.click(file);
    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("src/hub.ts"));
  });
});
