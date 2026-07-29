import Link from "next/link";
import { ArrowLeft, ArrowRight, CornerUpLeft, Share2 } from "lucide-react";
import type { DocLinkRef } from "@/lib/docs/doc-types";

/**
 * Footer relations: outbound links, backlinks, and prev/next.
 *
 * "Related" is what this doc points at; "Referenced by" is what points here.
 * Keeping them visually distinct matters — collapsing them into one "related"
 * pile is how wikis end up with link lists nobody trusts.
 */
export function DocRelations({
  related,
  backlinks,
  prev,
  next,
}: {
  related: DocLinkRef[];
  backlinks: DocLinkRef[];
  prev: DocLinkRef | null;
  next: DocLinkRef | null;
}) {
  const hasRelations = related.length > 0 || backlinks.length > 0;
  if (!hasRelations && !prev && !next) return null;

  return (
    <footer className="lib-footer">
      {hasRelations ? (
        <div className="docs-relations">
          {related.length > 0 ? (
            <div>
              <h2 className="docs-relations-title">
                <Share2 size={11} aria-hidden />
                Related
              </h2>
              <ul className="docs-relation-list">
                {related.map((doc) => (
                  <li key={doc.slug}>
                    <Link href={doc.href} className="docs-relation-link">
                      {doc.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {backlinks.length > 0 ? (
            <div>
              <h2 className="docs-relations-title">
                <CornerUpLeft size={11} aria-hidden />
                Referenced by
              </h2>
              <ul className="docs-relation-list">
                {backlinks.map((doc) => (
                  <li key={doc.slug}>
                    <Link href={doc.href} className="docs-relation-link">
                      {doc.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {prev || next ? (
        <nav className="lib-pager" aria-label="Documentation">
          {prev ? (
            <Link href={prev.href} className="lib-pager-link" data-dir="prev">
              <span className="lib-pager-eyebrow">
                <ArrowLeft size={11} aria-hidden />
                Previous
              </span>
              <span className="lib-pager-title">{prev.title}</span>
            </Link>
          ) : null}
          {next ? (
            <Link href={next.href} className="lib-pager-link" data-dir="next">
              <span className="lib-pager-eyebrow">
                Next
                <ArrowRight size={11} aria-hidden />
              </span>
              <span className="lib-pager-title">{next.title}</span>
            </Link>
          ) : null}
        </nav>
      ) : null}
    </footer>
  );
}
