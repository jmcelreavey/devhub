"use client";

import Link from "next/link";
import { GraduationCap, PanelRight, SquareArrowOutUpRight, TerminalSquare } from "lucide-react";
import { EmptyState, FetchError, PageHeader } from "@/components";
import { LearnContent } from "../../LearnContent";
import { openRepoInCursor } from "@/lib/open-in-cursor-client";
import { openTerminal } from "@/lib/terminal-launch";
import { useLive } from "@/lib/use-fetch";
import { useToast } from "@/lib/use-toast";
import type { ReposApiPayload } from "../../types";

/**
 * Dedicated, full-page learning screen — the same LearnContent the /repos side
 * panel shows, with room to breathe. Reached via the panel's "Expand" button,
 * the persistent learn dock, or directly at /repos/learn/<repo>.
 */
export function LearnScreen({ name, focusLab }: { name: string; focusLab?: string }) {
  const toast = useToast();
  const { data, error, isLoading, mutate } = useLive<ReposApiPayload>("/api/repos", { refreshInterval: 0 });
  const repo = data?.repos.find((r) => r.name === name) ?? null;

  return (
    <div className="page-wrapper">
      <PageHeader
        title={`Learn ${name}`}
        subtitle={repo ? <span className="font-mono">{repo.path}</span> : "Repo learning pack"}
        actions={
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              className="btn btn-ghost text-xs"
              onClick={() => repo && openTerminal({ cwd: repo.path, label: repo.name })}
              disabled={!repo}
              title="Open an in-app terminal in this repo"
            >
              <TerminalSquare size={13} /> Terminal
            </button>
            <button
              type="button"
              className="btn btn-ghost text-xs"
              onClick={() => void openRepoInCursor(name, toast)}
              title="Open the repo in Cursor"
            >
              <SquareArrowOutUpRight size={13} /> Cursor
            </button>
            <Link href={`/repos?learn=${encodeURIComponent(name)}`} className="btn btn-ghost text-xs" title="Open as a side panel over /repos">
              <PanelRight size={13} /> As panel
            </Link>
          </span>
        }
      />

      <div className="mt-4" style={{ maxWidth: 860 }}>
        {error ? (
          <FetchError message={error.message} onRetry={() => void mutate()} />
        ) : repo ? (
          <LearnContent repo={repo} focusLab={focusLab} />
        ) : !isLoading ? (
          <EmptyState
            icon={<GraduationCap size={32} />}
            title="Repo not found"
            subtitle={`No local clone named "${name}". Clone it from the Repos page first.`}
          />
        ) : (
          <div className="card card-body">
            <div className="skeleton" style={{ height: 12, width: "40%" }} />
          </div>
        )}
      </div>
    </div>
  );
}
