import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTaskPlanServer, updatePlanSections } from "./plan-peer.ts";
import { NotesStorage } from "./storage.ts";
import { blocksToText, textToBlocks } from "./convert.ts";
import type { Context } from "./context.ts";

const scope = { taskId: "11111111-1111-4111-8111-111111111111", date: "2026-10-19" };
const notePath = `task-notes/${scope.date}-${scope.taskId}`;
let root: string;
let storage: NotesStorage;
let client: Client;
let server: ReturnType<typeof createTaskPlanServer>;
let context: { id: string; notePath: string; done: boolean };
let get: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "task-plan-peer-"));
  storage = new NotesStorage(root);
  storage.write(notePath, textToBlocks("# My task\n\n## Plan\nOld plan\n\n## Personal notes\nKeep this\n\n## Acceptance\nOld acceptance\n"));
  context = { id: scope.taskId, notePath, done: false };
  get = vi.fn(async () => context);
  server = createTaskPlanServer({ storage, dashboard: { get } } as unknown as Context, scope);
  client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});
afterEach(async () => { await client.close(); await server.close(); fs.rmSync(root, { recursive: true, force: true }); });

it("exposes only task-bound context and section updates, with no general write or agent tools", async () => {
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["task_plan_context", "task_plan_update"]);
  const result = await client.callTool({ name: "task_plan_context", arguments: {} });
  expect(JSON.stringify(result)).toContain("Keep this");
  expect(get).toHaveBeenCalledWith(`/api/tasks/implement/plan?taskId=${scope.taskId}&date=${scope.date}`);
  const write = vi.spyOn(storage, "write");
  const update = await client.callTool({ name: "task_plan_update", arguments: { plan: "New plan\n### Steps\nRead files", acceptance: "Must pass", openQuestions: "None", path: "other-note" } });
  expect(update.isError).not.toBe(true);
  expect(write).toHaveBeenCalledOnce(); expect(write.mock.calls[0][0]).toBe(notePath);
  const text = blocksToText(storage.read(notePath)!.content as unknown[]);
  expect(text).toContain("Keep this"); expect(text).toContain("New plan"); expect(text).toContain("Must pass"); expect(text).not.toContain("Old plan");
  expect(storage.read("other-note")).toBeNull();
});

it.each(["owner", "closed", "path"])("refuses updates when the task scope changes: %s", async (change) => {
  if (change === "owner") context.id = "another-task";
  if (change === "closed") context.done = true;
  if (change === "path") context.notePath = "../other";
  const write = vi.spyOn(storage, "write");
  expect((await client.callTool({ name: "task_plan_update", arguments: { plan: "x", acceptance: "x", openQuestions: "" } })).isError).toBe(true);
  expect(write).not.toHaveBeenCalled();
});

it("does not let a section payload inject another top-level section", async () => {
  const write = vi.spyOn(storage, "write");
  const result = await client.callTool({ name: "task_plan_update", arguments: { plan: "## Personal notes\nReplaced", acceptance: "x", openQuestions: "" } });
  expect(result.isError).toBe(true); expect(write).not.toHaveBeenCalled();
});

it("replaces only the requested sections and preserves later sections", () => {
  expect(updatePlanSections("## Plan\nOld\n## Mine\nKeep\n", { Plan: "New" })).toBe("## Plan\nNew\n## Mine\nKeep\n");
});
