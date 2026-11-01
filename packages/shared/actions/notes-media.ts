import { z } from "zod";
import { defineAction } from "./define.ts";

interface MediaContext<Input> { execute: (input: Input) => unknown }

export const notesMediaUploadInput = z.object({ bytes: z.instanceof(Uint8Array) });
export const notesMediaUpload = defineAction<typeof notesMediaUploadInput, MediaContext<z.output<typeof notesMediaUploadInput>>, unknown>({
  input: notesMediaUploadInput,
  http: { method: "POST", path: "/api/notes-media" },
  mcp: { reason: "The editor uploads images to the local content-addressed media store; MCP asset writes use the vault instead." },
  handler: (input, context) => context.execute(input),
});

export const notesMediaReadInput = z.object({ name: z.string() });
export const notesMediaRead = defineAction<typeof notesMediaReadInput, MediaContext<z.output<typeof notesMediaReadInput>>, unknown>({
  input: notesMediaReadInput,
  http: { method: "GET", path: "/api/notes-media/[name]" },
  mcp: { reason: "Media is served as binary content to the notes editor and has no MCP read tool." },
  handler: (input, context) => context.execute(input),
});

export const notesMediaSearchInput = z.object({ query: z.string().max(300) });
export const notesMediaSearch = defineAction<typeof notesMediaSearchInput, MediaContext<z.output<typeof notesMediaSearchInput>>, unknown>({
  input: notesMediaSearchInput,
  http: { method: "GET", path: "/api/notes-media/search" },
  mcp: { reason: "OCR search is a notes editor media picker operation." },
  handler: (input, context) => context.execute(input),
});

export const notesMediaIndexInput = z.object({});
export const notesMediaIndex = defineAction<typeof notesMediaIndexInput, MediaContext<z.output<typeof notesMediaIndexInput>>, unknown>({
  input: notesMediaIndexInput,
  http: { method: "POST", path: "/api/notes-media/search" },
  mcp: { reason: "Reindexing editor media is a local dashboard operation." },
  handler: (input, context) => context.execute(input),
});
