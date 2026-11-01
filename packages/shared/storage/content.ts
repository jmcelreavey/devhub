import type { SearchNotesOptions, SearchResult } from "../notes-search/search.ts";

/** Revisions are opaque. A null expectation means that the path must not exist. */
export type ContentRevision = string;

export class ContentConflictError extends Error {
  constructor(readonly path: string) {
    super(`Content changed: ${path}. Refresh and try again.`);
    this.name = "ContentConflictError";
  }
}

export interface ContentFile {
  path: string;
  content: Buffer;
  revision: ContentRevision;
  modified: number;
  size: number;
}

export interface ContentDirectory {
  path: string;
  revision: ContentRevision;
}

export interface ContentEntry {
  type: "file" | "dir";
  name: string;
  path: string;
  children?: ContentEntry[];
}

export interface ContentSearchOptions extends SearchNotesOptions {
  format?: "notes" | "docs";
}

export interface ContentAssets {
  read(path: string): Promise<ContentFile | null>;
  write(path: string, content: string | Uint8Array, expectedRevision: ContentRevision | null): Promise<ContentFile>;
  move(from: string, to: string, expectedRevision: ContentRevision, expectedDestinationRevision?: ContentRevision | null): Promise<ContentFile>;
  delete(path: string, expectedRevision: ContentRevision): Promise<boolean>;
}

/** One vault of notes, documents, and their associated files. */
export interface ContentStorage extends ContentAssets {
  list(directory?: string): Promise<ContentEntry[]>;
  search(query: string, options?: ContentSearchOptions): Promise<SearchResult[]>;
  readonly assets: ContentAssets;
  readDirectory(path: string): Promise<ContentDirectory | null>;
  createDirectory(path: string): Promise<ContentDirectory>;
  moveDirectory(from: string, to: string, expectedRevision: ContentRevision): Promise<ContentDirectory>;
  deleteDirectory(path: string, expectedRevision: ContentRevision): Promise<boolean>;
}

/** Append from a fresh read; retry once if another writer wins the race. */
export async function appendContent(storage: ContentAssets, path: string, content: string | Uint8Array): Promise<ContentFile> {
  for (let attempt = 0; ; attempt++) {
    const current = await storage.read(path);
    const combined = Buffer.concat([current?.content ?? Buffer.alloc(0), Buffer.from(content)]);
    try {
      return await storage.write(path, combined, current?.revision ?? null);
    } catch (error) {
      if (!(error instanceof ContentConflictError) || attempt !== 0) throw error;
    }
  }
}
