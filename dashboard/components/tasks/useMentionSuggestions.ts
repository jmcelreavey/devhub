import { useMemo } from "react";
import {
  filterRows,
  KIND_CONFIG,
  refFromRow,
  type PickerKind,
} from "@/components/EntityLinkDialog";
import { useLive } from "@/lib/hooks/use-fetch";
import type { EntityRef } from "@/lib/entity-note";
import { todayISO } from "@/lib/utils";

/** `@fragment` at the end of the text, at the start or after whitespace. */
export const MENTION_TAIL = /(^|\s)@([^\s@]*)$/;

const PER_KIND = 4;
const TOTAL = 10;

export interface MentionSuggestion {
  kind: PickerKind;
  title: string;
  meta: string;
  ref: EntityRef;
}

/** Rows for one kind; the endpoint is only fetched once an `@` opens (SWR caches it after). */
function useKindSuggestions(kind: PickerKind, query: string | null): MentionSuggestion[] {
  const config = KIND_CONFIG[kind];
  const { data } = useLive<unknown>(query === null ? null : config.endpoint, { refreshInterval: 0 });
  const today = todayISO();
  const rows = useMemo(() => config.toRows(data, { today }), [config, data, today]);
  return useMemo(
    () =>
      query === null
        ? []
        : filterRows(rows, query)
            .slice(0, PER_KIND)
            .map((row) => ({ kind, title: row.title, meta: row.meta, ref: refFromRow(kind, row.id, rows) })),
    [kind, query, rows],
  );
}

/**
 * Cross-kind `@` search for the task composer. Filtering is in-memory over the
 * same lists the Link dialog uses, so `@` and the dialog never disagree.
 * `query` is null while no `@fragment` is open. Calendar is left out — events
 * aren't something you @ from a task. Result order is the call order below.
 */
export function useMentionSuggestions(query: string | null): MentionSuggestion[] {
  const repo = useKindSuggestions("repo", query);
  const task = useKindSuggestions("task", query);
  const jira = useKindSuggestions("jira", query);
  const pr = useKindSuggestions("pr", query);
  const note = useKindSuggestions("note", query);
  const diagram = useKindSuggestions("diagram", query);
  return useMemo(
    () => [...repo, ...task, ...jira, ...pr, ...note, ...diagram].slice(0, TOTAL),
    [repo, task, jira, pr, note, diagram],
  );
}
