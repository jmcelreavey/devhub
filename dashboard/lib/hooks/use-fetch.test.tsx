/** @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { PanelVisibilityContext } from "./panel-visibility";
import { useLive } from "./use-fetch";

function Probe() {
  const { data } = useLive<{ ok: boolean }>("/api/thing");
  return <span data-testid="out">{data ? "loaded" : "empty"}</span>;
}

/** Fresh SWR cache per test so a paused hook cannot read a previous one's data. */
function renderProbe(visible: boolean) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PanelVisibilityContext.Provider value={visible}>
        <Probe />
      </PanelVisibilityContext.Provider>
    </SWRConfig>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useLive panel pausing", () => {
  /**
   * Workspace tabs keep every visited route mounted, so without pausing, each
   * tab ever opened keeps polling forever — including the repo route that hits
   * Jira, Calendar and GitHub.
   */
  it("does not fetch while its panel is hidden", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderProbe(false);
    await waitFor(() => expect(screen.getByTestId("out").textContent).toBe("empty"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches when its panel is visible", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderProbe(true);
    await waitFor(() => expect(screen.getByTestId("out").textContent).toBe("loaded"));
    expect(fetchSpy).toHaveBeenCalledWith("/api/thing");
  });

  it("defaults to visible outside a keep-alive panel", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <Probe />
      </SWRConfig>,
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  });
});
