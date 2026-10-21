/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { ToastProvider } from "@/components/shell/ToastProvider";
import { useJiraTransition } from "./use-jira-transition";
import { clearTransitionOverride, useTransitionOverride } from "@/lib/jira/transition-state";

const wrapper = ({ children }: { children: ReactNode }) => <SWRConfig value={{ provider: () => new Map() }}><ToastProvider>{children}</ToastProvider></SWRConfig>;
const moved = (extra: object = {}) => Response.json({ ok: true, key: "PTF-5106", from: "In Progress", to: "Done", undo: { toStatusId: "3", label: "Move back to In Progress" }, proposal: { id: "c3a1f7a4-0b52-4a0e-9f0b-2f2b7b0f5e11" }, ...extra });
function setup() {
  const resolvers: Array<(response: Response) => void> = [];
  const fetcher = vi.fn<typeof fetch>((input) => String(input).includes("/transition")
    ? new Promise<Response>((resolve) => resolvers.push(resolve))
    : Promise.resolve(Response.json({})));
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(() => ({ move: useJiraTransition(), override: useTransitionOverride("PTF-5106") }), { wrapper });
  const transitionCalls = () => fetcher.mock.calls.filter(([url]) => String(url).includes("/transition")) as Array<[string, RequestInit]>;
  return { hook, resolvers, transitionCalls };
}
beforeEach(() => clearTransitionOverride("PTF-5106"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("useJiraTransition", () => {
  it("paints the destination before Jira answers, then reports success with Undo", async () => {
    const { hook, resolvers, transitionCalls } = setup();
    let done: Promise<boolean>;
    act(() => { done = hook.result.current.move("PTF-5106", { transitionId: "41" }, { to: "Done" }); });
    // Optimistic and pending, with no response yet.
    expect(hook.result.current.override).toEqual({ status: "Done", pending: true });
    const [, init] = transitionCalls()[0];
    expect(JSON.parse(init.body as string)).toEqual({ transitionId: "41" });
    await act(async () => { resolvers[0](moved()); await done; });
    expect(await done!).toBe(true);
    await waitFor(() => expect(hook.result.current.override).toBeUndefined());
    expect(document.body).toHaveTextContent("PTF-5106 moved to Done");
    expect(document.body.querySelector("button.toast-action")).toHaveTextContent("Undo");
    expect(document.body.querySelector("a.toast-action")).toBeNull();
  });
  it("Undo moves back by status, not by a transition id it cannot know", async () => {
    const { hook, resolvers, transitionCalls } = setup();
    let done: Promise<boolean>;
    act(() => { done = hook.result.current.move("PTF-5106", { transitionId: "41" }, { to: "Done" }); });
    await act(async () => { resolvers[0](moved()); await done; });
    act(() => { (document.body.querySelector("button.toast-action") as HTMLButtonElement).click(); });
    await waitFor(() => expect(transitionCalls()).toHaveLength(2));
    expect(JSON.parse(transitionCalls()[1][1].body as string)).toEqual({ toStatusId: "3" });
    expect(hook.result.current.override).toEqual({ status: "In Progress", pending: true });
  });
  it("binds a Home transition and its Undo to the same profile", async () => {
    const { hook, resolvers, transitionCalls } = setup();
    let done: Promise<boolean>;
    act(() => { done = hook.result.current.move("PTF-5106", { transitionId: "41" }, { to: "Done", profile: "work" }); });
    expect(new Headers(transitionCalls()[0][1].headers).get("x-devhub-task-profile")).toBe("work");
    await act(async () => { resolvers[0](moved()); await done; });
    act(() => { (document.body.querySelector("button.toast-action") as HTMLButtonElement).click(); });
    await waitFor(() => expect(transitionCalls()).toHaveLength(2));
    expect(new Headers(transitionCalls()[1][1].headers).get("x-devhub-task-profile")).toBe("work");
  });
  it("rolls the chip back and says why when Jira refuses", async () => {
    const { hook, resolvers } = setup();
    let done: Promise<boolean>;
    act(() => { done = hook.result.current.move("PTF-5106", { transitionId: "41" }, { to: "Done" }); });
    await act(async () => { resolvers[0](Response.json({ error: "This transition is no longer available.", outcome: "failed" }, { status: 409 })); await done; });
    expect(await done!).toBe(false);
    await waitFor(() => expect(hook.result.current.override).toBeUndefined());
    expect(document.body.querySelector("[role=alert]")).toHaveTextContent("PTF-5106 wasn't moved: This transition is no longer available.");
  });
  it("ignores a second click while the first is in flight", async () => {
    const { hook, resolvers, transitionCalls } = setup();
    act(() => { void hook.result.current.move("PTF-5106", { transitionId: "41" }, { to: "Done" }); });
    let second: boolean | undefined;
    await act(async () => { second = await hook.result.current.move("PTF-5106", { transitionId: "41" }, { to: "Done" }); });
    expect(second).toBe(false);
    expect(transitionCalls()).toHaveLength(1);
    await act(async () => { resolvers[0](moved()); });
  });
});
