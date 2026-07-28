"use client";

/**
 * Note footer relations — outbound EntityRefs from ## Links plus reverse
 * lookups from /api/entity-links. Mirrors DocRelations visually so hop-around
 * feels the same across docs and notes.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CornerUpLeft, Link2, Share2 } from "lucide-react";
import {
  defaultHrefForRef,
  parseEntityLinksFromMarkdown,
  type EntityRef,
} from "@/lib/entity-note";
import { blocksToText } from "@/lib/markdown-convert";
import type { DevHubPartialBlock } from "@/lib/blocknote/schema";

export function EntityRelationsPanel({
  notePath,
  blocks,
  onAddLink,
}: {
  notePath: string;
  blocks: DevHubPartialBlock[] | null;
  /** Opens the shared EntityLinkDialog (owned by the editor page). */
  onAddLink?: () => void;
}) {
  const outbound = useMemo(() => {
    if (!blocks?.length) return [] as EntityRef[];
    try {
      return parseEntityLinksFromMarkdown(blocksToText(blocks));
    } catch {
      return [];
    }
  }, [blocks]);

  const [inbound, setInbound] = useState<EntityRef[]>([]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ kind: "note", id: notePath, label: notePath });
    void fetch(`/api/entity-links?${params}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { related?: EntityRef[] } | null) => {
        if (cancelled || !json?.related) return;
        setInbound(json.related);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [notePath]);

  const related = outbound;
  const backlinks = inbound.filter(
    (r) => !outbound.some((o) => o.kind === r.kind && o.id === r.id),
  );

  if (related.length === 0 && backlinks.length === 0 && !onAddLink) return null;

  return (
    <footer className="lib-footer entity-relations-footer">
      <div className="docs-relations">
        {related.length > 0 ? (
          <div>
            <h2 className="docs-relations-title">
              <Share2 size={11} aria-hidden />
              Linked
            </h2>
            <ul className="docs-relation-list">
              {related.map((ref) => {
                const href = defaultHrefForRef(ref);
                return (
                  <li key={`out-${ref.kind}-${ref.id}`}>
                    {href ? (
                      <Link href={href} className="docs-relation-link">
                        <span className="entity-rel-kind">{ref.kind}</span> {ref.label}
                      </Link>
                    ) : (
                      <span className="docs-relation-link">
                        <span className="entity-rel-kind">{ref.kind}</span> {ref.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : onAddLink ? (
          <p className="entity-relations-empty">No outbound links yet.</p>
        ) : null}
        {backlinks.length > 0 ? (
          <div>
            <h2 className="docs-relations-title">
              <CornerUpLeft size={11} aria-hidden />
              Also linked
            </h2>
            <ul className="docs-relation-list">
              {backlinks.map((ref) => {
                const href = defaultHrefForRef(ref);
                return (
                  <li key={`in-${ref.kind}-${ref.id}`}>
                    {href ? (
                      <Link href={href} className="docs-relation-link">
                        <span className="entity-rel-kind">{ref.kind}</span> {ref.label}
                      </Link>
                    ) : (
                      <span className="docs-relation-link">
                        <span className="entity-rel-kind">{ref.kind}</span> {ref.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {onAddLink ? (
          <div className="entity-relations-add">
            <button
              type="button"
              className="btn btn-ghost text-xs flex items-center gap-1"
              onClick={() => {
                window.dispatchEvent(new Event("devhub:dismiss-hovertips"));
                onAddLink();
              }}
            >
              <Link2 size={12} aria-hidden />
              Add link
            </button>
          </div>
        ) : null}
      </div>
    </footer>
  );
}
