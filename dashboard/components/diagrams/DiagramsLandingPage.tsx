"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Clock, Folder, PenTool, Plus } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  DIAGRAM_ROOT_AREA_ID,
  readLastDiagramFolder,
  type DiagramAreaGroup,
  type DiagramSummary,
} from "@/lib/diagrams/diagram-browse";
import { diagramFolderHref } from "@/lib/diagram-utils";

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const PREVIEW_LINKS = 3;

function AreaCard({ area }: { area: DiagramAreaGroup }) {
  const preview = area.diagrams.slice(0, PREVIEW_LINKS);
  const remaining = area.diagrams.length - preview.length;
  const href = area.id === DIAGRAM_ROOT_AREA_ID ? "/diagrams" : diagramFolderHref(area.id);

  return (
    <Link href={href} className="lib-area">
      <span className="lib-area-head">
        <span className="lib-section-icon">
          <Folder size={15} aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="lib-area-title">{area.label}</span>
          <span className="lib-area-count">
            {area.diagrams.length} {area.diagrams.length === 1 ? "diagram" : "diagrams"}
            {area.folderCount > 0
              ? ` · ${area.folderCount} ${area.folderCount === 1 ? "folder" : "folders"}`
              : ""}
          </span>
        </span>
      </span>
      <span className="lib-area-links">
        {preview.map((d) => (
          <span key={d.path} className="lib-area-link">
            {d.name}
          </span>
        ))}
        {remaining > 0 ? <span className="lib-area-more">+{remaining} more</span> : null}
      </span>
    </Link>
  );
}

export function DiagramsLandingPage({
  areas,
  recent,
  total,
  onNewDiagram,
  onNewFolder,
}: {
  areas: DiagramAreaGroup[];
  recent: DiagramSummary[];
  total: number;
  onNewDiagram: () => void;
  onNewFolder: () => void;
}) {
  const resumeFolder = useSyncExternalStore(
    () => () => {},
    readLastDiagramFolder,
    () => "",
  );

  if (total === 0) {
    return (
      <div className="lib-shell" data-layout="wide">
        <div className="lib-main">
          <header className="lib-hero">
            <h1 className="lib-hero-title">Diagrams</h1>
            <p className="lib-hero-sub">Nothing here yet.</p>
          </header>
          <EmptyState
            icon={<PenTool size={32} />}
            title="No diagrams yet"
            subtitle={
              <button type="button" className="btn btn-ghost text-xs mt-2" onClick={onNewDiagram}>
                Create your first diagram
              </button>
            }
          />
        </div>
      </div>
    );
  }

  // Top-level diagrams show up in "recent"; area cards are folders only.
  const browsable = areas.filter((area) => area.id !== DIAGRAM_ROOT_AREA_ID);

  return (
    <div className="lib-shell" data-layout="wide">
      <div className="lib-main">
        <header className="lib-hero">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="lib-hero-title">Diagrams</h1>
              <p className="lib-hero-sub">
                Architecture and flow canvases — {total} diagrams across {browsable.length}{" "}
                areas. Filter from the sidebar, or <kbd className="lib-kbd">⌘K</kbd> anywhere.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onNewFolder}
                className="btn btn-ghost text-xs flex items-center gap-1"
              >
                <Folder size={13} aria-hidden />
                New folder
              </button>
              <button
                type="button"
                onClick={onNewDiagram}
                className="btn btn-primary text-xs flex items-center gap-1"
              >
                <Plus size={14} aria-hidden />
                New diagram
              </button>
            </div>
          </div>
        </header>

        {resumeFolder ? (
          <section className="lib-section">
            <Link href={diagramFolderHref(resumeFolder)} className="lib-recent-row">
              <Folder size={13} className="lib-card-icon" aria-hidden />
              <span className="lib-recent-title">Continue in {resumeFolder}</span>
              <span className="lib-recent-meta">Last folder</span>
            </Link>
          </section>
        ) : null}

        {recent.length > 0 ? (
          <section className="lib-section">
            <h2 className="lib-areas-title">
              <Clock size={12} aria-hidden />
              Picking up where you left off
            </h2>
            <ul className="lib-recent">
              {recent.map((d) => (
                <li key={d.path}>
                  <Link href={d.href} className="lib-recent-row">
                    <PenTool size={13} className="lib-card-icon" aria-hidden />
                    <span className="lib-recent-title">{d.name}</span>
                    <span className="lib-recent-meta">
                      {d.modified
                        ? DATE_FORMAT.format(new Date(d.modified))
                        : d.area || "Top level"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="lib-section">
          <h2 className="lib-areas-title">Browse by area</h2>
          <div className="lib-area-grid">
            {browsable.map((area) => (
              <AreaCard key={area.id} area={area} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
