import Link from "next/link";
import { ArrowRight, BookOpen, Clock, Folder } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { DocIcon } from "@/components/docs/doc-icons";
import { NewDocButton } from "@/components/docs/NewDocButton";
import { ROOT_SECTION_ID } from "@/lib/docs/doc-sections";
import type { DocSectionGroup, DocSummary } from "@/lib/docs/doc-types";

/**
 * The docs home.
 *
 * Deliberately not an index. The sidebar already lists every page, and the
 * first version of this repeated it card-for-card — two copies of the same
 * list, neither of which told you where to start. This page answers three
 * questions instead: what is this, where do I begin, and what areas exist.
 * Browsing a whole area is the section page's job.
 */

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** The ordered route through the docs for someone arriving cold. */
const FIRST_RUN_PATH: Array<{ slug: string; step: string }> = [
  { slug: "getting-started/installation", step: "Install it" },
  { slug: "getting-started/setup", step: "Point it at your repo" },
  { slug: "architecture/overview", step: "Learn the shape" },
  { slug: "guides/skills", step: "Do something with it" },
];

/** How many doc links to preview inside a section card. */
const PREVIEW_LINKS = 3;

function FirstRunPath({ docs }: { docs: Array<DocSummary & { step: string }> }) {
  if (docs.length === 0) return null;
  return (
    <section className="lib-path">
      <div className="lib-path-head">
        <h2 className="lib-path-title">New here?</h2>
        <p className="lib-path-sub">Four pages, about fifteen minutes, in this order.</p>
      </div>
      <ol className="lib-path-steps">
        {docs.map((doc, i) => (
          <li key={doc.slug}>
            <Link href={doc.href} className="lib-path-step">
              <span className="lib-path-num">{i + 1}</span>
              <span className="min-w-0">
                <span className="lib-path-step-label">{doc.step}</span>
                <span className="lib-path-step-title">{doc.title}</span>
              </span>
              <ArrowRight size={13} className="lib-path-arrow" aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SectionCard({ section }: { section: DocSectionGroup }) {
  const docs = section.docs.filter((doc) => !doc.draft);
  const preview = docs.slice(0, PREVIEW_LINKS);
  const remaining = docs.length - preview.length;

  return (
    <Link href={`/docs/${section.meta.id}`} className="lib-area">
      <span className="lib-area-head">
        <span className="lib-section-icon">
          <DocIcon name={section.meta.icon} fallback={Folder} size={15} aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="lib-area-title">{section.meta.label}</span>
          <span className="lib-area-count">
            {docs.length} {docs.length === 1 ? "page" : "pages"}
          </span>
        </span>
      </span>
      {section.meta.description ? (
        <span className="lib-area-desc">{section.meta.description}</span>
      ) : null}
      <span className="lib-area-links">
        {preview.map((doc) => (
          <span key={doc.slug} className="lib-area-link">
            {doc.title}
          </span>
        ))}
        {remaining > 0 ? (
          <span className="lib-area-more">+{remaining} more</span>
        ) : null}
      </span>
    </Link>
  );
}

export function DocsLandingPage({
  sections,
  recent,
  totalDocs,
}: {
  sections: DocSectionGroup[];
  recent: DocSummary[];
  totalDocs: number;
}) {
  if (totalDocs === 0) {
    return (
      <div className="lib-shell" data-layout="wide">
        <div className="lib-main">
          <header className="lib-hero">
            <h1 className="lib-hero-title">Documentation</h1>
            <p className="lib-hero-sub">Nothing here yet.</p>
          </header>
          <EmptyState
            icon={<BookOpen size={32} />}
            title="No docs yet"
            subtitle={
              <NewDocButton className="btn btn-ghost text-xs mt-2" label="Create your first doc" />
            }
          />
        </div>
      </div>
    );
  }

  const bySlug = new Map(sections.flatMap((s) => s.docs).map((doc) => [doc.slug, doc]));
  const firstRun = FIRST_RUN_PATH.map(({ slug, step }) => {
    const doc = bySlug.get(slug);
    return doc && !doc.draft ? { ...doc, step } : null;
  }).filter((doc): doc is DocSummary & { step: string } => doc !== null);

  // The root "Overview" pseudo-section is the docs README, which this page
  // already stands in for. Showing it as an area would be a card that links to
  // a section containing one doc that says what this page just said.
  const areas = sections.filter(
    (section) =>
      section.meta.id !== ROOT_SECTION_ID && section.docs.some((doc) => !doc.draft),
  );

  return (
    <div className="lib-shell" data-layout="wide">
      <div className="lib-main">
        <header className="lib-hero">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="lib-hero-title">Documentation</h1>
              <p className="lib-hero-sub">
                How DevHub is put together and how to work on it — {totalDocs} pages across{" "}
                {areas.length} areas. Search the full text from{" "}
                <kbd className="lib-kbd">Filter docs</kbd> in the sidebar, or{" "}
                <kbd className="lib-kbd">⌘K</kbd> anywhere.
              </p>
            </div>
            <NewDocButton
              className="btn btn-primary text-xs shrink-0 flex items-center gap-1"
              label="New doc"
              withIcon
            />
          </div>
        </header>

        <FirstRunPath docs={firstRun} />

        <section className="lib-section">
          <h2 className="lib-areas-title">Browse by area</h2>
          <div className="lib-area-grid">
            {areas.map((section) => (
              <SectionCard key={section.meta.id} section={section} />
            ))}
          </div>
        </section>

        {recent.length > 0 ? (
          <section className="lib-section">
            <h2 className="lib-areas-title">
              <Clock size={12} aria-hidden />
              Recently updated
            </h2>
            <ul className="lib-recent">
              {recent.map((doc) => (
                <li key={doc.slug}>
                  <Link href={doc.href} className="lib-recent-row">
                    <DocIcon name={doc.icon} size={13} className="lib-card-icon" aria-hidden />
                    <span className="lib-recent-title">{doc.title}</span>
                    <span className="lib-recent-meta">
                      {DATE_FORMAT.format(new Date(doc.modified))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
