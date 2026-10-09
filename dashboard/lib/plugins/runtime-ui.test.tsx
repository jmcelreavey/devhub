/** @vitest-environment jsdom */
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import RuntimePage from "../../app/plugins/runtime/[name]/runtime-page";
import { PreviewBody } from "../../app/plugins/views";
import { readyOperation } from "./ui-test-fixtures";
import { runtimeInventory, type RuntimeContribution } from "./runtime-contract";

const runtime: RuntimeContribution = { api: "1", transport: "request-worker", entry: "worker.mjs", sha256: "a".repeat(64), lockfile: { path: "package-lock.json", sha256: "b".repeat(64) }, pages: [{ path: "/", label: "Sample" }], routes: [{ path: "/status", method: "GET" }], mcp: [{ name: "sample", description: "Sample tools" }], permissions: { env: ["SAMPLE_TOKEN"], network: [], exec: false } };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows executable risk and exact declared permissions before consent", () => {
  const operation = readyOperation();
  const preview = { ...operation.preview!, runtime, inventory: runtimeInventory(runtime) };
  render(<PreviewBody operation={operation} preview={preview} selected={[]} onSelect={() => {}} syncHeading="Sync to" syncNote={null} runtimeLabel="This computer" />);
  expect(screen.getByText("High risk · Runs local code")).toBeInTheDocument();
  expect(screen.getByText("SAMPLE_TOKEN")).toBeInTheDocument();
  expect(screen.getByText("GET /status")).toBeInTheDocument();
  expect(screen.getByText(/Publisher signature not verified/)).toBeInTheDocument();
});

it("renders HTML only inside an opaque frame with networking blocked", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => Response.json(options?.method === "POST" ? { result: "<h1>Sample</h1>" } : runtime)));
  render(<RuntimePage name="sample-tools" />);
  const frame = await screen.findByTitle("sample-tools plugin page");
  expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  expect(frame.getAttribute("srcdoc")).toContain("connect-src 'none'");
  expect(screen.queryByRole("heading", { name: "Sample" })).not.toBeInTheDocument();
});

it("offers retry after a runtime error instead of leaving a loading skeleton", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "Runtime files changed" } }, { status: 409 })));
  render(<RuntimePage name="sample-tools" />);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Runtime files changed"));
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
});
