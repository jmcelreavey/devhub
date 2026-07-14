"use client";

import { FlaskConical, RefreshCw } from "lucide-react";
import { FetchError, PageHeader } from "@/components";
import { BootScreen, useBootGate } from "@/components/TodayBootScreen";
import { SimpleMarkdown } from "@/components/SimpleMarkdown";
import { useLive } from "@/lib/use-fetch";
import { useToast } from "@/lib/use-toast";
import { useState } from "react";

interface ResearchCard {
  interest: string;
  title: string;
  summary: string;
  updatedAt?: string;
  sourcePath?: string;
  signals?: { title: string; url?: string }[];
}

interface ResearchPayload {
  script: string | null;
  researchDir: string;
  files: { name: string; mtimeMs: number; size: number }[];
  cards: ResearchCard[];
}

export default function ResearchClient() {
  const { data, error, isLoading, mutate } = useLive<ResearchPayload>("/api/research", {
    refreshInterval: 0,
  });
  const boot = useBootGate(data !== undefined || !!error);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  /**
   * Re-scans the research folder. There's no API trigger for the Last30Days
   * script itself yet — fresh digs are kicked off from Briefing.
   */
  async function rescanResearchDir() {
    setBusy(true);
    try {
      await mutate();
      toast.success("Research folder re-scanned — run Last30Days from Briefing for fresh digs");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Re-scan failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-wrapper">
      <BootScreen state={boot} />
      <PageHeader
        title="Research"
        subtitle="Last30Days / interest digests as a first-class Library tab."
        actions={
          <button type="button" className="btn btn-secondary text-xs" onClick={() => void rescanResearchDir()} disabled={busy}>
            <RefreshCw size={13} className={busy ? "animate-spin" : undefined} />
            Re-scan
          </button>
        }
      />

      {error ? (
        <FetchError message={error.message} onRetry={() => void mutate()} />
      ) : isLoading || !data ? (
        <div className="mt-4 space-y-3" aria-hidden>
          <div className="skeleton h-4 w-2/3" />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="skeleton h-28 rounded-lg" />
            <div className="skeleton h-28 rounded-lg" />
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="text-xs text-text-subtle">
            Script: {data.script ? <code>{data.script}</code> : <em>not found — install last30days skill</em>}
            <span className="mx-2">·</span>
            Dir: <code>{data.researchDir}</code>
            <span className="mx-2">·</span>
            {data.files.length} files
          </div>

          {data.cards.length === 0 ? (
            <p className="text-xs text-text-subtle">
              No research cards yet. Add interests in Briefing prefs or drop markdown under{" "}
              <code>notes/research/</code>.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {data.cards.map((c) => (
                <article key={c.sourcePath ?? c.title} className="card card-body">
                  <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-text">
                    <FlaskConical size={13} aria-hidden />
                    {c.title}
                  </div>
                  {c.updatedAt ? (
                    <div className="mb-2 text-[11px] text-text-muted">
                      {new Date(c.updatedAt).toLocaleString()}
                    </div>
                  ) : null}
                  <SimpleMarkdown text={c.summary} compact />
                  {c.signals && c.signals.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-xs text-text-subtle">
                      {c.signals.slice(0, 5).map((s) => (
                        <li key={s.title}>
                          {s.url ? (
                            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent">
                              {s.title}
                            </a>
                          ) : (
                            s.title
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
