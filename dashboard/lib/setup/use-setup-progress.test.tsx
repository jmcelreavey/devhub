// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SetupProgressSchema, type SetupProgress } from "./progress";
import { useSetupProgress } from "./use-setup-progress";

let stored: SetupProgress;
beforeEach(() => {
  stored = SetupProgressSchema.parse({ currentStep: "paths", goals: ["code"] });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === "POST") stored = SetupProgressSchema.parse(JSON.parse(String(options.body)));
    return { ok: true, json: async () => stored };
  }));
});
afterEach(() => vi.unstubAllGlobals());

it("resumes by step id, then persists navigation before a reload", async () => {
  const first = renderHook(() => useSetupProgress());
  await waitFor(() => expect(first.result.current.ready).toBe(true));
  expect(first.result.current.currentStep).toBe("paths");
  expect(first.result.current.goals).toEqual(["code"]);
  act(() => first.result.current.setCurrentStepId("github"));
  await waitFor(() => expect(stored.currentStep).toBe("github"));
  first.unmount();
  const second = renderHook(() => useSetupProgress());
  await waitFor(() => expect(second.result.current.currentStep).toBe("github"));
});

it("saves completion only after outstanding step writes", async () => {
  const hook = renderHook(() => useSetupProgress());
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => hook.result.current.setCurrentStepId("done"));
  await act(async () => hook.result.current.finish());
  expect(stored).toMatchObject({ completed: true, currentStep: "done" });
});

it("reports save failures and retries the current state", async () => {
  const hook = renderHook(() => useSetupProgress());
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
  act(() => hook.result.current.setCurrentStepId("github"));
  await waitFor(() => expect(hook.result.current.error).toContain("Couldn't save"));
  act(() => hook.result.current.retry());
  await waitFor(() => expect(hook.result.current.error).toBe(""));
  expect(stored.currentStep).toBe("github");
});
