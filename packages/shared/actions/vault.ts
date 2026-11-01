import { z } from "zod";
import type { TreeEntry } from "../vault/vault-storage.ts";
import { defineAction } from "./define.ts";

export const notesTreeInput = z.object({});

export interface NotesTreeReader {
  list: () => TreeEntry[] | Promise<TreeEntry[]>;
}

export const notesTree = defineAction<typeof notesTreeInput, NotesTreeReader, TreeEntry[]>({
  input: notesTreeInput,
  http: { method: "GET", path: "/api/tree" },
  mcp: { reason: "The MCP notes_list tool exposes only daily and root workspace notes, not the complete vault tree." },
  handler: (_input, context) => context.list(),
});

export const vaultHistoryInput = z.object({
  vault: z.enum(["notes", "docs"]),
  path: z.string(),
  limit: z.string(),
});

export interface VaultHistoryReader {
  list: (vault: "notes" | "docs", path: string, limit: number) => unknown;
}

export const vaultHistory = defineAction<typeof vaultHistoryInput, VaultHistoryReader, unknown>({
  input: vaultHistoryInput,
  http: { method: "GET", path: "/api/vault/history" },
  mcp: { reason: "Per-file Git history is a browser vault workflow; MCP history records tool calls instead." },
  handler: ({ vault, path, limit }, context) => context.list(vault, path, Number(limit)),
});
