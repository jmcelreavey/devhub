/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { afterEach, expect, it, vi } from "vitest";
import type { Subscriber } from "@/lib/events/task-subscription";
import { useLive } from "./use-fetch";

const stream = vi.hoisted(() => ({ subscriber: undefined as Subscriber | undefined }));
vi.mock("@/lib/events/task-subscription", () => ({
  subscribeToTaskEvents: (subscriber: Subscriber) => {
    stream.subscriber = subscriber;
    return () => { stream.subscriber = undefined; };
  },
}));
vi.mock("@/lib/hooks/panel-visibility", () => ({ usePanelVisible: () => true }));
afterEach(cleanup);

it("renders an in-flight result before catching up with a burst of live updates", async () => {
  const responses: Array<(value: { value: string }) => void> = [];
  const fetcher = vi.fn(() => new Promise<{ value: string }>(resolve => { responses.push(resolve); }));
  const wrapper = ({ children }: { children: ReactNode }) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
  const { result } = renderHook(() => useLive<{ value: string }>("/api/repos", { fetcher, revalidateOnFocus: false }), { wrapper });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  act(() => { for (let i = 0; i < 5; i++) stream.subscriber?.refresh(); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => { responses[0]({ value: "first" }); });
  await waitFor(() => expect(result.current.data?.value).toBe("first"));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await act(async () => { responses[1]({ value: "updated" }); });
  await waitFor(() => expect(result.current.data?.value).toBe("updated"));
  expect(fetcher).toHaveBeenCalledTimes(2);
});
