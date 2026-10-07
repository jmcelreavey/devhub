// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetupGateStatus } from "@/lib/nav";

const live = vi.hoisted(() => ({ data: undefined as SetupGateStatus | undefined }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: () => ({ data: live.data }) }));

import { useSetupStatus } from "./use-setup-status";

const KEY = "devhub:setup-status";

beforeEach(() => {
  window.localStorage.clear();
  live.data = undefined;
});
afterEach(cleanup);

describe("useSetupStatus", () => {
  it("serves the last-known status while the live fetch is in flight", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ github: true }));
    const { result } = renderHook(() => useSetupStatus());
    expect(result.current).toEqual({ github: true });
  });

  it("prefers the live answer and remembers it for next load", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ github: true }));
    live.data = { github: false, jira: true };
    const { result } = renderHook(() => useSetupStatus());
    expect(result.current).toEqual({ github: false, jira: true });
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "null")).toEqual({ github: false, jira: true });
  });

  it("treats a corrupt cache as no cache", () => {
    window.localStorage.setItem(KEY, "{not json");
    const { result } = renderHook(() => useSetupStatus());
    expect(result.current).toBeUndefined();
  });
});
