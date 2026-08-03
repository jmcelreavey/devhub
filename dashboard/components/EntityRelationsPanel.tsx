"use client";

/**
 * Note footer relations — outbound EntityRefs from ## Links plus reverse
 * lookups from /api/entity-links. Mirrors DocRelations visually so hop-around
 * feels the same across docs and notes.
 */

import { useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { CornerUpLeft, Link2, Share2 } from "lucide-react";
import {
  defaultHrefForRef,
  parseEntityLinksFromMarkdown,
  type EntityRef,
} from "@/lib/entity-note";
import { blocksToText } from "@/lib/markdown-convert";
import type { DevHubPartialBlock } from "@/lib/blocknote/schema";

/** Outbound and backlink lists are the same list with a different heading. */
function RelationGroup({
  title,
  icon: Icon,
  refs,
  keyPrefix,
}: {
  title: string;
  icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  refs: EntityRef[];
  keyPrefix: string;
}) {
  if (refs.length === 0) return null;

  return (
    <div>
      <h2 className="docs-relations-title">
        <Icon size={11} aria-hidden />
        {title}
      </h2>
      <ul className="docs-relation-list">
        {refs.map((ref) => {
          const href = defaultHrefForRef(ref);
          const external = !!href && /^https?:\/\//i.test(href);
          const body = (
            <>
              <span className="entity-rel-kind">{ref.kind}</span> {ref.label}
            </>
          );
          return (
            <li key={`${keyPrefix}-${ref.kind}-${ref.id}`}>
              {href ? (
                <Link
                  href={href}
                  className="docs-relation-link"
                  {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                  {body}
                </Link>
              ) : (
                <span className="docs-relation-link">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

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
          <RelationGroup title="Linked" icon={Share2} refs={related} keyPrefix="out" />
        ) : onAddLink ? (
          <p className="entity-relations-empty">No outbound links yet.</p>
        ) : null}
        <RelationGroup title="Also linked" icon={CornerUpLeft} refs={backlinks} keyPrefix="in" />
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
