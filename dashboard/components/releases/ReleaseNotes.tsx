"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import useSWR from "swr";
import Link from "next/link";
import { BookOpen, X } from "lucide-react";
import { ModalShell } from "@/components/shell/ModalShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { FetchError } from "@/components/ui/FetchError";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { HoverTip } from "@/components/ui/HoverTip";
import { isDesktop } from "@/lib/desktop/bridge";
import { dismissReleaseVersion, isReleaseVersionDismissed, observeReleaseVersion, openReleaseNotes, RELEASE_NOTES_EVENT, type ReleaseNotesPayload } from "@/lib/release-notes";
import type { ReleaseEntry } from "@shared/release-notes/index.mjs";

interface ReleaseContextValue {
  version: string | null;
  banner: boolean;
  pill: boolean;
  dismiss: () => void;
  release: ReleaseEntry | undefined;
}

interface ReleaseAnnouncement {
  version: string;
  dismissed: boolean;
}

const ReleaseContext = createContext<ReleaseContextValue | null>(null);

async function fetchReleaseNotes(url: string): Promise<ReleaseNotesPayload> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Release notes couldn't be loaded.");
  return response.json();
}

function useReleaseNotesData() {
  return useSWR<ReleaseNotesPayload>("/api/release-notes", fetchReleaseNotes, { revalidateOnFocus: false });
}

export function ReleaseNotesContent({ release }: { release: ReleaseEntry | undefined }) {
  if (!release?.markdown) return <EmptyState bare title="No notes for this version yet" subtitle="The full changelog is still available. Unreleased changes aren't part of this release." />;
  return <SimpleMarkdown text={release.markdown} className="release-notes-copy" />;
}

export function ReleaseNotesProvider({ children }: { children: ReactNode }) {
  const { data, error, isLoading, mutate } = useReleaseNotesData();
  const [open, setOpen] = useState(false);
  const [banner, setBanner] = useState(false);
  const [announcement, setAnnouncement] = useState<ReleaseAnnouncement | null>(null);
  const version = data?.currentVersion ?? null;
  const release = data?.releases.find((entry) => entry.version === version);
  const dismiss = useCallback(() => {
    setBanner(false);
    setOpen(false);
    if (!version) return;
    setAnnouncement({ version, dismissed: true });
    try {
      dismissReleaseVersion(window.localStorage, version, isDesktop());
    } catch {
      return;
    }
  }, [version]);

  useEffect(() => {
    if (!banner || open) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('dialog[open], [aria-modal="true"]:not([hidden]), [role="menu"]:not([hidden]), [role="listbox"]:not([hidden])')) return;
      event.preventDefault();
      dismiss();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [banner, open, dismiss]);

  useEffect(() => {
    const show = () => { setOpen(true); setBanner(false); };
    window.addEventListener(RELEASE_NOTES_EVENT, show);
    return () => window.removeEventListener(RELEASE_NOTES_EVENT, show);
  }, []);

  useEffect(() => {
    if (!version) return;
    const frame = requestAnimationFrame(() => {
      try {
        setBanner(observeReleaseVersion(window.localStorage, version, isDesktop()));
        setAnnouncement({ version, dismissed: isReleaseVersionDismissed(window.localStorage, version, isDesktop()) });
      } catch {
        setBanner(false);
        setAnnouncement({ version, dismissed: false });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [version]);

  return (
    <ReleaseContext.Provider value={{ version, banner, pill: announcement?.version === version && !announcement?.dismissed, dismiss, release }}>
      {children}
      <ModalShell open={open} onClose={dismiss} title={version ? `What's new in v${version}` : "What's new"} icon={<BookOpen size={16} />} maxWidth="max-w-2xl" description="Release highlights from the changelog." footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/changelog" className="btn btn-ghost" onClick={dismiss}>Full changelog</Link>
          <button type="button" className="btn btn-primary" onClick={dismiss}>Done</button>
        </div>
      }>
        {isLoading ? <div role="status" aria-label="Loading release notes"><SkeletonRows count={4} height={32} /></div> : error ? <FetchError bare message="Release notes couldn't be loaded." onRetry={() => void mutate()} /> : <ReleaseNotesContent release={release} />}
      </ModalShell>
    </ReleaseContext.Provider>
  );
}

export function WhatsNewButton({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const context = useContext(ReleaseContext);
  return <button type="button" className={`btn btn-ghost text-xs ${className}`} onClick={openReleaseNotes} aria-label="What's new" title={context?.version ? `What's new in v${context.version}` : "What's new"}>
    <BookOpen size={14} aria-hidden />
    {!compact && <span>{context?.version ? `v${context.version} · ` : ""}What&apos;s new</span>}
  </button>;
}

export function WhatsNewPill({ compact = false }: { compact?: boolean }) {
  const context = useContext(ReleaseContext);
  if (!context?.pill || !context.version) return null;
  const hideLabel = `Hide What's new for v${context.version}`;
  return <div className="shrink-0 px-1 py-2 flex justify-center">
    <div role="group" aria-label="What's new notification" className={`release-version-pill${compact ? " release-version-pill-compact" : ""}`}>
      <WhatsNewButton compact={compact} className="release-version-open" />
      <HoverTip label={hideLabel} pos={compact ? "bottom-start" : "top-end"}>
        <button type="button" className="hub-icon-btn release-version-dismiss" aria-label={hideLabel} title={hideLabel} onClick={(event) => {
          event.stopPropagation();
          const focusTarget = event.currentTarget.closest("aside")?.querySelector<HTMLButtonElement>(".sidebar-collapse-btn");
          context.dismiss();
          focusTarget?.focus();
        }}><X size={12} aria-hidden /></button>
      </HoverTip>
    </div>
  </div>;
}

export function ReleaseNotesAbout() {
  const context = useContext(ReleaseContext);
  return <section id="about" aria-labelledby="release-about-heading" className="card mb-6 p-4 flex flex-wrap items-center justify-between gap-3">
    <div>
      <h2 id="release-about-heading" className="text-sm font-semibold">About</h2>
      <p className="text-xs text-text-muted mt-1">DevHub · {context?.version ? <Link href="/changelog" className="underline underline-offset-2" aria-label={`Changelog for v${context.version}`}>Version v{context.version}</Link> : "Version unavailable"}</p>
    </div>
    <div className="flex flex-wrap items-center gap-2"><WhatsNewButton /><Link href="/changelog" className="btn btn-ghost text-xs">Changelog</Link></div>
  </section>;
}

export function WhatsNewBanner() {
  const context = useContext(ReleaseContext);
  if (!context?.banner) return null;
  return <section aria-label={`What's new in v${context.version}`} className="release-news-panel">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold">What&apos;s new in v{context.version}</h2>
        <div className="release-news-highlights">
          {context.release?.highlights.length ? <SimpleMarkdown compact text={context.release.highlights.slice(0, 3).map((highlight) => `- ${highlight}`).join("\n")} /> : <p className="text-xs text-text-muted mt-2">No highlights for this version yet.</p>}
        </div>
        <button type="button" className="btn btn-ghost mt-2 text-xs" onClick={openReleaseNotes}>Read release notes</button>
      </div>
      <button type="button" className="hub-icon-btn release-news-dismiss shrink-0" aria-label="Dismiss what's new" title="Dismiss what's new (Esc)" onClick={context.dismiss}><X size={16} aria-hidden /></button>
    </div>
  </section>;
}

export function ChangelogView() {
  const { data, error, isLoading, mutate } = useReleaseNotesData();
  return <div className="page-wrapper">
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap justify-between items-start gap-3 mb-6">
        <div><h1 className="text-2xl font-semibold">Changelog</h1><p className="text-sm text-text-muted mt-2">Release notes, newest first. {data?.currentVersion && `You're running v${data.currentVersion}.`}</p></div>
        <WhatsNewButton />
      </div>
      {isLoading ? <div role="status" aria-label="Loading changelog"><SkeletonRows count={4} height={90} /></div> : error ? <FetchError message="The changelog couldn't be loaded." onRetry={() => void mutate()} /> : !data?.releases.length ? <EmptyState title="No releases listed yet" subtitle="Release notes will appear here when they're added to CHANGELOG.md." /> : data.releases.map((release) => <article key={release.version} id={`release-${release.version}`} className="release-history-entry">
        {release.version === "Unreleased" ? <details>
          <summary className="cursor-pointer text-sm font-semibold">Unreleased <span className="font-normal text-text-muted">· Not shipped in a release yet.</span></summary>
          <div className="mt-4"><ReleaseNotesContent release={release} /></div>
        </details> : <>
          <div className="flex flex-wrap items-center gap-3 mb-3"><h2 className="text-lg font-semibold">v{release.version}</h2>{release.date && <time className="text-xs text-text-muted" dateTime={release.date}>{release.date}</time>}{release.version === data.currentVersion && <span className="badge badge-accent">Current version</span>}</div>
          <ReleaseNotesContent release={release} />
        </>}
      </article>)}
    </div>
  </div>;
}

export function IncomingReleaseNotes({ version, notes }: { version: string | undefined; notes: string | undefined }) {
  return <details open className="release-update-notes">
    <summary className="text-xs font-medium cursor-pointer">What&apos;s new{version ? ` in v${version}` : ""}</summary>
    <div className="release-update-copy mt-2">
      {notes?.trim() && !/^See https:\/\/github\.com\/\S+$/.test(notes.trim()) ? <SimpleMarkdown text={notes} /> : <p className="text-xs text-text-muted">This release doesn&apos;t include notes. You can check <a href="https://github.com/jmcelreavey/devhub/releases" target="_blank" rel="noopener noreferrer" className="underline">the release page</a> before installing.</p>}
    </div>
  </details>;
}
