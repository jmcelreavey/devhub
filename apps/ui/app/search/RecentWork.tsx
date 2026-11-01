"use client";

import Link from "@/lib/navigation";
import { ArrowUpRight, Clock, FileText } from "lucide-react";
import { useWorkspaceTabs } from "@/components/shell/WorkspaceTabs";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useLive } from "@/lib/hooks/use-fetch";
import type { NoteSummary } from "../../../core/src/lib/notes/note-index";

export function RecentWork() {
  const { history } = useWorkspaceTabs();
  const { data, error, mutate } = useLive<{ notes: NoteSummary[] }>("/api/notes-index?recent=1");
  const seen = new Set<string>(["/search"]);
  const recent = [...history].reverse().filter((entry) => {
    if (seen.has(entry.href)) return false;
    seen.add(entry.href);
    return true;
  }).slice(0, 5);

  return <div className="grid gap-6 md:grid-cols-2">
    {recent.length > 0 ? <section aria-labelledby="recent-work-title">
      <h2 id="recent-work-title" className="mb-3 text-sm font-medium">Pick up where you left off</h2>
      <ul className="divide-y divide-border">{recent.map((entry) => <li key={entry.href}>
        <Link href={entry.href} className="flex items-center gap-3 rounded px-2 py-3 hover:bg-bg-elevated">
          <Clock size={15} className="shrink-0 text-text-subtle" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm">{entry.label}</span>
          <ArrowUpRight size={14} className="text-text-subtle" aria-hidden />
        </Link>
      </li>)}</ul>
    </section> : null}
    <section aria-labelledby="recent-notes-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="recent-notes-title" className="text-sm font-medium">Recently edited notes</h2>
        <Link href="/notes" className="text-xs text-text-muted hover:underline">All notes</Link>
      </div>
      {!data && !error ? <SkeletonRows count={4} height={48} /> : null}
      {error ? <FetchError message="Couldn’t load recent notes." onRetry={() => void mutate()} /> : null}
      {data?.notes.length === 0 ? <p className="text-sm text-text-muted">Your recent notes will appear here. <Link href="/notes" className="underline">Open Notes</Link></p> : null}
      <ul className="divide-y divide-border">{data?.notes.map((note) => <li key={note.slug}>
        <Link href={note.href} className="flex items-start gap-3 rounded px-2 py-3 hover:bg-bg-elevated">
          <FileText size={15} className="mt-0.5 shrink-0 text-text-subtle" aria-hidden />
          <span className="min-w-0"><span className="block truncate text-sm">{note.title}</span>
            {note.summary ? <span className="mt-1 block line-clamp-1 text-xs text-text-subtle">{note.summary}</span> : null}
          </span>
        </Link>
      </li>)}</ul>
    </section>
  </div>;
}
