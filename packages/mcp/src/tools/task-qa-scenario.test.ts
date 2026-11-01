import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { taskQaSources } from "../../../../packages/shared/task-note/qa-scenario.ts";
import { createContext } from "../context.ts";
import { blocksToText, textToBlocks } from "../convert.ts";
import type { NotesStorage } from "../storage.ts";
import { registerTaskNoteTools } from "./task-note.ts";

const notePath = "task-notes/2026-10-26-task-123";
const qaScenario = { goals: [{ assertion: "text", selector: "[data-testid='save-status']", expected: "Saved", description: "Saved status is shown" }] };
let root: string;
let storage: NotesStorage;
let client: Client;
let server: McpServer;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "task-qa-mcp-"));
  vi.stubEnv("REPO_ROOT", root);
  vi.stubEnv("NOTES_DIR", root);
  vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
  vi.stubEnv("DOCS_DIR", path.join(root, "docs"));
  vi.stubEnv("DEVHUB_ENV_FILE", path.join(root, "empty.env"));
  const context = createContext();
  storage = context.storage;
  await storage.write(notePath, textToBlocks("# Task\n\n## Verification\nBaseline capture: required\nKeep this verification note.\n\n## Your notes\nKeep my notes.\n"), storage.read(notePath)?.revision ?? null);
  server = new McpServer({ name: "test", version: "1" });
  registerTaskNoteTools(server, context);
  client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
  await server.close();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("task QA declaration over MCP", () => {
  it("preserves existing note blocks while recording bounded assertions", async () => {
    const before = storage.read(notePath)!.content as Array<{ type: string; props?: { language?: string } }>;
    const result = await client.callTool({ name: "task_note_update", arguments: { notePath, op: "set_qa_scenario", qaScenario } });
    expect(result.isError).not.toBe(true);
    const blocks = storage.read(notePath)!.content as Array<{ type: string; props?: { language?: string } }>;
    expect(blocks.filter((block) => block.type !== "codeBlock" || block.props?.language !== "devhub-qa")).toEqual(before);
    const markdown = blocksToText(blocks);
    expect(markdown).toContain("Baseline capture: required");
    expect(markdown).toContain("[data-testid='save-status']");
  });

  it("rejects agent-supplied URLs, actions and trivial assertions without writing", async () => {
    const before = storage.read(notePath)!.content;
    const unsafe = [
      { ...qaScenario, url: "https://example.com" },
      { ...qaScenario, actions: [{ kind: "click", selector: "button" }] },
      { goals: [{ assertion: "visible", selector: "body", description: "Page exists" }] },
      { goals: [{ assertion: "text", selector: "main", expected: " ", description: "Empty text" }] },
    ];
    for (const candidate of unsafe) {
      const result = await client.callTool({ name: "task_note_update", arguments: { notePath, op: "set_qa_scenario", qaScenario: candidate } });
      expect(result.isError).toBe(true);
      expect(storage.read(notePath)!.content).toEqual(before);
    }
  });

  it.each([
    "## Verification\nQA scenario: saved",
    "## Verification\n### Checks\n- QA scenario: saved",
    "## Verification checklist\nQA scenario:",
    "## Verification\nQA scenario: saved\n```devhub-qa\n{}\n```",
    "## Verification\nQA scenario: saved\n## Other\nKeep\n## Verification\nMore checks",
  ])("rejects conflicting sources without changing note data: %s", async (section) => {
    await storage.write(notePath, textToBlocks(`# Task\n${section}\n## Your notes\nKeep my notes.\n`), storage.read(notePath)?.revision ?? null);
    const before = storage.read(notePath)!.content;
    const result = await client.callTool({ name: "task_note_update", arguments: { notePath, op: "set_qa_scenario", qaScenario, baselineRequired: true } });
    expect(result.isError).toBe(true);
    expect(storage.read(notePath)!.content).toEqual(before);
  });

  it("ignores fenced examples and references in another section when setting assertions", async () => {
    await storage.write(notePath, textToBlocks("# Task\n## Verification\n```text\nQA scenario: example\n```\n### Checks\nKeep this check.\n## Other\nQA scenario: elsewhere\n"), storage.read(notePath)?.revision ?? null);
    const result = await client.callTool({ name: "task_note_update", arguments: { notePath, op: "set_qa_scenario", qaScenario } });
    expect(result.isError).not.toBe(true);
    const markdown = blocksToText(storage.read(notePath)!.content as unknown[]);
    expect(taskQaSources(markdown)).toMatchObject({ verificationSections: 1, references: [], declarations: [expect.any(String)] });
    expect(markdown).toContain("QA scenario: elsewhere");
  });

  it("can request a baseline without replacing a saved scenario reference", async () => {
    await storage.write(notePath, textToBlocks("# Task\n## Verification\nQA scenario: saved\n## Your notes\nKeep my notes.\n"), storage.read(notePath)?.revision ?? null);
    const result = await client.callTool({ name: "task_note_update", arguments: { notePath, op: "set_qa_scenario", baselineRequired: true } });
    expect(result.isError).not.toBe(true);
    const markdown = blocksToText(storage.read(notePath)!.content as unknown[]);
    expect(taskQaSources(markdown)).toMatchObject({ references: ["saved"], declarations: [] });
    expect(markdown).toContain("Keep my notes.");
  });
});
