/** @vitest-environment jsdom */
import { act, render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import DiagramEditorPage from "./client";

const canvas = vi.hoisted(() => ({ save: undefined as ((data: unknown) => void) | undefined }));
vi.mock("@/components/diagrams/TldrawCanvas", () => ({
  TldrawCanvas: ({ onChange }: { onChange: (data: unknown) => void }) => {
    canvas.save = onChange;
    return null;
  },
}));

afterEach(() => vi.unstubAllGlobals());

it("persists queued snapshots with the returned revision after navigating away", async () => {
  vi.stubGlobal("EventSource", class extends EventTarget { close() {} });
  const first = { type: "tldraw", version: 1, store: { shapes: ["first"] } };
  const latest = { type: "tldraw", version: 1, store: { shapes: ["first", "latest"] } };
  let persisted: unknown = { type: "tldraw", version: 1, store: {} };
  let revision = "initial";
  let releaseFirst!: () => void;
  const firstResponse = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const writes: Array<{ content: unknown; expectedRevision: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/share") return Response.json({ shares: [] });
    if (url !== "/api/notes/diagrams/fixture") throw new Error(`Unexpected request: ${url}`);
    if (init?.method !== "PUT") return Response.json({ content: persisted, revision });
    const body = JSON.parse(String(init.body)) as { content: unknown; expectedRevision: string };
    writes.push(body);
    if (writes.length === 1) await firstResponse;
    if (body.expectedRevision !== revision) return Response.json({ error: "Conflict" }, { status: 409 });
    persisted = body.content;
    revision = `revision-${writes.length}`;
    return Response.json({ revision });
  }));
  const router = createMemoryRouter([
    { path: "/diagrams/fixture", element: <DiagramEditorPage path={["fixture"]} /> },
    { path: "/diagrams", element: null },
  ], { initialEntries: ["/diagrams/fixture"] });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(canvas.save).toBeDefined());

  act(() => { canvas.save!(first); });
  await waitFor(() => expect(writes).toHaveLength(1));
  act(() => { canvas.save!(latest); });
  await act(async () => { await router.navigate("/diagrams"); });
  await act(async () => { releaseFirst(); });

  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1].expectedRevision).toBe("revision-1");
  expect(persisted).toEqual(latest);
});
