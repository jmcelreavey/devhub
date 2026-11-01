"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { canonicalizeEntityRef, type EntityRef } from "../../../../packages/shared/ui-lib/entity-note";
import { taskNoteLinkToEntityRef } from "@shared/entity-note/index.ts";

interface ComposerDraft {
  text: string;
  links: EntityRef[];
}

const EMPTY_DRAFT: ComposerDraft = { text: "", links: [] };

/** Write on each edit so navigation or closing the window cannot drop a debounce. */
export function useTaskComposerDraft(scope: string | undefined) {
  const key = scope === undefined ? undefined : `devhub:task-draft:v1:${scope}`;
  const current = useRef({ key: undefined as string | undefined, draft: EMPTY_DRAFT });
  const [snapshot, setSnapshot] = useState({ key: undefined as string | undefined, draft: EMPTY_DRAFT });
  const [storageUnavailable, setStorageUnavailable] = useState(false);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      let draft = EMPTY_DRAFT;
      try {
        const raw = localStorage.getItem(key);
        const saved: unknown = raw ? JSON.parse(raw) : null;
        if (saved && typeof saved === "object" && "text" in saved && typeof saved.text === "string" &&
            "links" in saved && Array.isArray(saved.links)) {
          draft = { text: saved.text, links: saved.links.flatMap((ref: unknown) => {
            if (!ref || typeof ref !== "object" || !("kind" in ref) || !("id" in ref) || typeof ref.kind !== "string" || typeof ref.id !== "string") return [];
            const entity = taskNoteLinkToEntityRef({ kind: ref.kind, id: ref.id,
              label: "label" in ref && typeof ref.label === "string" ? ref.label : ref.id,
              ...("href" in ref && typeof ref.href === "string" ? { href: ref.href } : {}),
            });
            const canonical = entity ? canonicalizeEntityRef(entity) : null;
            return canonical ? [canonical] : [];
          }) };
        }
        setStorageUnavailable(false);
      } catch {
        setStorageUnavailable(true);
      }
      current.current = { key, draft };
      setSnapshot(current.current);
    });
    return () => { cancelled = true; };
  }, [key]);

  const update = useCallback(<K extends keyof ComposerDraft>(field: K, action: SetStateAction<ComposerDraft[K]>) => {
    if (!key || current.current.key !== key) return;
    const previous = current.current.draft;
    const value = typeof action === "function"
      ? (action as (value: ComposerDraft[K]) => ComposerDraft[K])(previous[field])
      : action;
    const draft = { ...previous, [field]: value };
    current.current = { key, draft };
    setSnapshot(current.current);
    try {
      if (!draft.text && draft.links.length === 0) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(draft));
      setStorageUnavailable(false);
    } catch {
      setStorageUnavailable(true);
    }
  }, [key]);

  return {
    text: snapshot.key === key ? snapshot.draft.text : "",
    links: snapshot.key === key ? snapshot.draft.links : [],
    ready: key !== undefined && snapshot.key === key,
    storageUnavailable,
    setText: useCallback((value: SetStateAction<string>) => update("text", value), [update]),
    setLinks: useCallback((value: SetStateAction<EntityRef[]>) => update("links", value), [update]),
  };
}
