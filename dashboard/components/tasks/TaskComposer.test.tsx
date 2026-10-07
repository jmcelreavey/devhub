/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskComposer } from "./TaskComposer";

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const created = { id: "t1", text: "Ship it", done: false, createdAt: "2026-09-23T00:00:00Z" };
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => ({
  ok: true,
  status: 200,
  json: async () => (url.startsWith("/api/tasks") ? created : {}),
  text: async () => "",
}) as Response);

afterEach(cleanup);

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

function postBody(): { text: string; links?: { kind: string; id: string }[] } {
  const call = fetchMock.mock.calls.find(([url]) => url.startsWith("/api/tasks"));
  return JSON.parse(String(call?.[1]?.body));
}

describe("TaskComposer", () => {
  it("pins base links on every task and hands the created task back", async () => {
    const onAdded = vi.fn();
    render(
      <TaskComposer
        inputId="hub-add"
        baseLinks={[{ kind: "repo", id: "sample-repo", label: "sample-repo" }]}
        onAdded={onAdded}
      />,
    );

    const input = screen.getByLabelText("Add a task");
    fireEvent.change(input, { target: { value: "Ship it" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(created));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/tasks");
    expect(postBody()).toEqual({
      text: "Ship it",
      links: [{ kind: "repo", id: "sample-repo", label: "sample-repo" }],
    });
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("captures a draft on shift+enter and sends no links when none are set", async () => {
    const onAdded = vi.fn();
    render(<TaskComposer onAdded={onAdded} />);

    const input = screen.getByLabelText("Add a task");
    fireEvent.change(input, { target: { value: "Idea" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/tasks/capture");
    expect(postBody()).toEqual({ text: "Idea" });
  });
});
