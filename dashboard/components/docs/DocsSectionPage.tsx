import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import { DocIcon } from "@/components/docs/doc-icons";
import { DocRow, DocRowLink } from "@/components/docs/DocRow";
import type { DocSectionMeta } from "@/lib/docs/doc-sections";
import type { DocSummary } from "@/lib/docs/doc-types";

/**
 * A section's index page.
 *
 * Exists so the landing page can point at a section instead of listing every
 * doc inside it. Docs appear here in reading order with their descriptions —
 * this is the "browse a topic" surface, where the landing page is "find your
 * way in" and the sidebar is "jump somewhere specific".
 */
export function DocsSectionPage({
  meta,
  docs,
  prev,
  next,
}: {
  meta: DocSectionMeta;
  docs: DocSummary[];
  prev: DocSectionMeta | null;
  next: DocSectionMeta | null;
}) {
  return (
    <div className="lib-shell" data-layout="wide">
      <div className="lib-main">
        <nav className="lib-breadcrumbs" aria-label="Breadcrumb">
          <span className="flex items-center gap-1">
            <Link href="/docs">Docs</Link>
            <ChevronRight size={10} aria-hidden />
          </span>
          <span className="text-text-muted">{meta.label}</span>
        </nav>

        <header className="lib-hero">
          <div className="flex items-start gap-3">
            <span className="lib-section-icon lib-section-icon-lg">
              <DocIcon name={meta.icon} size={20} aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className="lib-hero-title">{meta.label}</h1>
              {meta.description ? <p className="lib-hero-sub">{meta.description}</p> : null}
            </div>
          </div>
        </header>

        <ol className="lib-section-list">
          {docs.map((doc, i) => (
            <li key={doc.slug}>
              <DocRow doc={doc} className="lib-section-item">
                <DocRowLink href={doc.href} className="lib-section-row">
                  <span className="lib-section-row-num">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0">
                    <span className="lib-section-row-title">
                      <DocIcon name={doc.icon} size={13} className="lib-card-icon" aria-hidden />
                      {doc.title}
                    </span>
                    {doc.description ? (
                      <span className="lib-section-row-desc">{doc.description}</span>
                    ) : null}
                  </span>
                  <span className="lib-section-row-meta">{doc.readingMinutes} min</span>
                  <ChevronRight size={14} className="text-text-subtle shrink-0" aria-hidden />
                </DocRowLink>
              </DocRow>
            </li>
          ))}
        </ol>

        {prev || next ? (
          <nav className="lib-pager lib-footer" aria-label="Sections">
            {prev ? (
              <Link href={`/docs/${prev.id}`} className="lib-pager-link" data-dir="prev">
                <span className="lib-pager-eyebrow">
                  <ArrowLeft size={11} aria-hidden />
                  Previous section
                </span>
                <span className="lib-pager-title">{prev.label}</span>
              </Link>
            ) : null}
            {next ? (
              <Link href={`/docs/${next.id}`} className="lib-pager-link" data-dir="next">
                <span className="lib-pager-eyebrow">
                  Next section
                  <ArrowRight size={11} aria-hidden />
                </span>
                <span className="lib-pager-title">{next.label}</span>
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
