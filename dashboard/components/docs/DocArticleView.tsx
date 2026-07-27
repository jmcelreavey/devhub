import Link from "next/link";
import { ChevronRight, Clock, History, Pencil, Tag } from "lucide-react";
import { DocContent } from "@/components/docs/DocContent";
import { DocRelations } from "@/components/docs/DocRelations";
import { DocToc } from "@/components/docs/DocToc";
import { getSectionMeta } from "@/lib/docs/doc-sections";
import type { DocDetail } from "@/lib/docs/doc-types";

// Explicit locale: this renders on the server, so `undefined` locale would
// resolve differently there than in the browser and trip hydration.
const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function DocArticleView({ detail }: { detail: DocDetail }) {
  const section = getSectionMeta(detail.section);

  return (
    <div className="docs-shell">
      <div className="docs-main">
        <nav className="docs-breadcrumbs" aria-label="Breadcrumb">
          {detail.breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : <span>{crumb.label}</span>}
              <ChevronRight size={10} aria-hidden />
            </span>
          ))}
          <span className="text-text-muted">{detail.title}</span>
        </nav>

        <div className="flex items-start justify-between gap-4">
          <h1 className="docs-title">{detail.title}</h1>
          <Link
            href={`${detail.href}?edit=1`}
            className="btn btn-ghost text-xs flex items-center gap-1 shrink-0 no-underline"
            title="Edit this doc"
          >
            <Pencil size={13} aria-hidden />
            Edit
          </Link>
        </div>

        {detail.description ? <p className="docs-lede">{detail.description}</p> : null}

        <div className="docs-meta">
          <span className="docs-meta-item">{section.label}</span>
          <span className="docs-meta-item">
            <Clock size={11} aria-hidden />
            {detail.readingMinutes} min read
          </span>
          {detail.modified > 0 ? (
            <span className="docs-meta-item">
              <History size={11} aria-hidden />
              Updated {DATE_FORMAT.format(new Date(detail.modified))}
            </span>
          ) : null}
          {detail.tags.length > 0 ? (
            <span className="docs-meta-item">
              <Tag size={11} aria-hidden />
              {detail.tags.map((tag) => (
                <span key={tag} className="docs-tag">
                  {tag}
                </span>
              ))}
            </span>
          ) : null}
        </div>

        <article className="docs-article">
          <DocContent nodes={detail.nodes} />
        </article>

        <DocRelations
          related={detail.related}
          backlinks={detail.backlinks}
          prev={detail.prev}
          next={detail.next}
        />
      </div>

      <DocToc entries={detail.toc} />
    </div>
  );
}
