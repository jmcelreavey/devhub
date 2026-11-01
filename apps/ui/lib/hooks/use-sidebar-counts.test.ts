/** @vitest-environment jsdom */
import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SWRConfig } from "swr";
import { afterEach, expect, it, vi } from "vitest";
import { useSidebarCounts } from "./use-sidebar-counts";


afterEach(() => vi.unstubAllGlobals());

it.each(["/", "/work"])("hides counts during profile switches and failed confirmation on %s", async (pathname) => {
  let active = "work";
  let failIdentity = false;
  vi.stubGlobal("EventSource", class extends EventTarget { close() {} });
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input, "http://localhost");
    if (url.pathname === "/api/tasks/profiles") {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json({ active }, { status: failIdentity ? 503 : 200 });
    }
    if (url.pathname === "/api/sidebar/counts") return Response.json({ profile: active, tasks: 1 });
    throw new Error(`Unexpected request: ${input}`);
  }));
  const cache = new Map();
  const wrapper = ({ children }: { children: ReactNode }) => createElement(SWRConfig, {
    value: { provider: () => cache, shouldRetryOnError: false },
  }, createElement(MemoryRouter, { initialEntries: [pathname] }, children));
  const { result } = renderHook(useSidebarCounts, { wrapper });
  await waitFor(() => expect(result.current?.tasks).toBe(1));

  act(() => window.dispatchEvent(new Event("devhub:task-profile-changing")));
  expect(result.current).toBeUndefined();
  active = "home";
  act(() => window.dispatchEvent(new Event("devhub:task-profile-changed")));
  await waitFor(() => expect(result.current).toMatchObject({ profile: "home", tasks: 1 }));

  act(() => window.dispatchEvent(new Event("devhub:task-profile-changing")));
  failIdentity = true;
  act(() => window.dispatchEvent(new Event("devhub:task-profile-changed")));
  expect(result.current).toBeUndefined();
});
