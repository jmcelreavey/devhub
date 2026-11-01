import type { PartialBlock } from "@blocknote/core";
import { localCalendarDateISO } from "../../../../packages/shared/ui-lib/local/calendar-date";
import { fetchStandup, readExcludedRepos, type StandupParams } from "@/lib/standup/params";

function assignFreshBlockIds(blocks: PartialBlock[]): PartialBlock[] {
  function walk(b: PartialBlock): PartialBlock {
    const next: PartialBlock = {
      ...b,
      id: crypto.randomUUID(),
    };
    if (Array.isArray(next.children) && next.children.length > 0) {
      next.children = next.children.map((c) => walk(c as PartialBlock));
    }
    return next;
  }
  return blocks.map(walk);
}

/** Relative notes path without `.json` (matches `/api/notes/...` and `/notes/...`). */
export function standupDailyNotePath(): string {
  return `daily/${localCalendarDateISO()}-standup`;
}

export type StandupTimeParams = StandupParams;

/**
 * Fetches standup markdown, converts to BlockNote blocks, PUTs `daily/<local-date>-standup.json`.
 * Clipboard-free path for the Today glance control.
 */
export async function saveStandupAsDailyNote(
  params?: StandupTimeParams,
): Promise<{ ok: true; notePath: string } | { ok: false; message: string }> {
  const result = await fetchStandup({
    ...params,
    excludeRepos: params?.excludeRepos ?? readExcludedRepos(),
  });
  if (!result.ok) return result;

  let content: PartialBlock[];
  try {
    const { BlockNoteEditor } = await import("@blocknote/core");
    const editor = BlockNoteEditor.create();
    const parsed = editor.tryParseMarkdownToBlocks(result.data.markdown) as PartialBlock[];
    content = assignFreshBlockIds(parsed);
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Could not build note from standup markdown",
    };
  }

  const notePath = standupDailyNotePath();
  try {
    const existing = await fetch("/api/notes/" + notePath, { cache: "no-store" });
    if (!existing.ok && existing.status !== 404) throw new Error(await existing.text());
    const expectedRevision: unknown = existing.ok ? (await existing.json()).revision : null;
    if (expectedRevision !== null && typeof expectedRevision !== "string") throw new Error("Note revision is unavailable. Reload and try again.");
    const put = await fetch(`/api/notes/${notePath}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, expectedRevision }),
    });
    const errBody = (await put.json().catch(() => ({}))) as { error?: string };
    if (!put.ok) {
      return { ok: false, message: errBody.error ?? `Save failed (${put.status})` };
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Network error" };
  }

  return { ok: true, notePath };
}
