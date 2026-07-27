import Link from "next/link";
import { ArrowRight, BookOpen, ChevronRight, Clock, Folder } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { DocIcon } from "@/components/docs/doc-icons";
import { NewDocButton } from "@/components/docs/NewDocButton";
import type { DocSectionGroup, DocSummary } from "@/lib/docs/doc-types";

// Explicit locale: this renders on the server, so `undefined` would resolve
// differently there than in the browser and trip hydration.
const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** Slugs that get top billing, in order. Anything missing is skipped. */
const START_HERE = [
  "getting-started/installation",
  "architecture/overview",
  "guides/skills",
  "reference/environment-variables",
];

function DocCard({ doc }: { doc: DocSummary }) {
  return (
    <Link href={doc.href} className="docs-card">
      <span className="docs-card-title">
        <span className="docs-card-label">
          <DocIcon name={doc.icon} size={13} className="docs-card-icon" aria-hidden />
          {doc.title}
        </span>
        <ChevronRight size={13} className="text-text-subtle shrink-0" aria-hidden />
      </span>
      {doc.description ? <span className="docs-card-desc">{doc.description}</span> : null}
      <span className="docs-card-meta">{doc.readingMinutes} min read</span>
    </Link>
  );
}

function StartHere({ docs }: { docs: DocSummary[] }) {
  if (docs.length === 0) return null;
  return (
    <section className="docs-starthere">
      {docs.map((doc) => (
          <Link key={doc.slug} href={doc.href} className="docs-starthere-card">
            <span className="docs-starthere-icon">
              <DocIcon name={doc.icon} size={16} aria-hidden />
            </span>
            <span className="docs-starthere-title">{doc.title}</span>
            {doc.description ? (
              <span className="docs-starthere-desc">{doc.description}</span>
            ) : null}
            <span className="docs-starthere-go">
              Read <ArrowRight size={11} aria-hidden />
            </span>
          </Link>
      ))}
    </section>
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
      <div className="docs-shell" data-layout="wide">
        <div className="docs-main">
          <header className="docs-hero">
            <h1 className="docs-hero-title">Documentation</h1>
            <p className="docs-hero-sub">Nothing here yet.</p>
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
  const startHere = START_HERE.map((slug) => bySlug.get(slug)).filter(
    (doc): doc is DocSummary => Boolean(doc) && !doc!.draft,
  );

  return (
    <div className="docs-shell" data-layout="wide">
      <div className="docs-main">
        <header className="docs-hero">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="docs-hero-title">Documentation</h1>
              <p className="docs-hero-sub">
                How DevHub is put together and how to work on it. {totalDocs} pages across{" "}
                {sections.length} sections — use <kbd className="docs-kbd">Filter docs</kbd> in the
                sidebar to search the full text.
              </p>
            </div>
            <NewDocButton
              className="btn btn-primary text-xs shrink-0 flex items-center gap-1"
              label="New doc"
              withIcon
            />
          </div>
        </header>

        <StartHere docs={startHere} />

        {recent.length > 0 ? (
          <section className="docs-section">
            <div className="docs-section-head">
              <span className="docs-section-icon">
                <Clock size={15} aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="docs-section-title">Recently updated</h2>
                <p className="docs-section-desc">What changed last.</p>
              </div>
            </div>
            <div className="docs-card-grid">
              {recent.map((doc) => (
                  <Link key={doc.slug} href={doc.href} className="docs-card">
                    <span className="docs-card-title">
                      <span className="docs-card-label">
                        <DocIcon name={doc.icon} size={13} className="docs-card-icon" aria-hidden />
                        {doc.title}
                      </span>
                      <ChevronRight size={13} className="text-text-subtle shrink-0" aria-hidden />
                    </span>
                    <span className="docs-card-meta">
                      {DATE_FORMAT.format(new Date(doc.modified))} · {doc.readingMinutes} min read
                    </span>
                  </Link>
              ))}
            </div>
          </section>
        ) : null}

        {sections.map((section) => {
          const docs = section.docs.filter((doc) => !doc.draft);
          if (docs.length === 0) return null;
          return (
            <section key={section.meta.id} id={section.meta.id} className="docs-section">
              <div className="docs-section-head">
                <span className="docs-section-icon">
                  <DocIcon name={section.meta.icon} fallback={Folder} size={15} aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 className="docs-section-title">{section.meta.label}</h2>
                  {section.meta.description ? (
                    <p className="docs-section-desc">{section.meta.description}</p>
                  ) : null}
                </div>
                <span className="docs-section-count">{docs.length}</span>
              </div>
              <div className="docs-card-grid">
                {docs.map((doc) => (
                  <DocCard key={doc.slug} doc={doc} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
