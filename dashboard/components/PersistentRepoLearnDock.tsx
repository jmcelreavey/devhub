"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, X } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import { repoLearnApiPath } from "@/lib/repo-learn-constants";

interface RepoLearnStatusPayload {
  ok: boolean;
  ready: boolean;
  gitHead: string;
  generatedAt: string | null;
}

interface HiddenRepoLearnDetail {
  repoName?: string;
}

export function PersistentRepoLearnDock() {
  const router = useRouter();
  const [repoName, setRepoName] = useState<string | null>(null);
  const startedRepoRef = useRef<string | null>(null);
  const key = repoName ? repoLearnApiPath(repoName, "/status") : null;
  const { data, error, isLoading } = useLive<RepoLearnStatusPayload>(key, {
    refreshInterval: repoName ? 3_000 : 0,
    revalidateOnFocus: true,
  });

  useEffect(() => {
    const onHidden = (event: Event) => {
      const detail = (event as CustomEvent<HiddenRepoLearnDetail>).detail;
      if (detail?.repoName) setRepoName(detail.repoName);
    };
    const onOpened = () => setRepoName(null);
    window.addEventListener("devhub:repo-learn-hidden", onHidden);
    window.addEventListener("devhub:repo-learn-opened", onOpened);
    return () => {
      window.removeEventListener("devhub:repo-learn-hidden", onHidden);
      window.removeEventListener("devhub:repo-learn-opened", onOpened);
    };
  }, []);

  useEffect(() => {
    if (!repoName || startedRepoRef.current === repoName) return;
    startedRepoRef.current = repoName;
    void fetch(repoLearnApiPath(repoName)).catch(() => {
      startedRepoRef.current = null;
    });
  }, [repoName]);

  if (!repoName) return null;

  const status = learnStatus({ data, error, isLoading });

  function showPanel() {
    // The dedicated learn screen always mounts fresh, so Show reliably reopens
    // the experience — unlike pushing ?learn= onto an already-mounted /repos,
    // which only reads the param on first mount.
    const name = repoName!;
    setRepoName(null);
    router.push(`/repos/learn/${encodeURIComponent(name)}`);
  }

  return (
    <div
      className="fixed left-4 right-4 rounded border shadow-lg md:left-auto"
      style={{
        borderColor: "var(--border)",
        background: "var(--bg-surface)",
        bottom: "calc(var(--shelf-h, 0px) + env(safe-area-inset-bottom, 0px) + 16px)",
        maxWidth: 320,
        zIndex: 9700,
      }}
    >
      <div className="flex items-center gap-2 p-2">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={showPanel} style={{ color: "var(--text)" }}>
          <span className="flex items-center gap-2 text-xs font-semibold">
            <GraduationCap size={13} aria-hidden /> Learn repo
          </span>
          <span className="mt-0.5 block truncate text-xs" style={{ color: "var(--text-subtle)" }}>
            {repoName} · {status}
          </span>
        </button>
        <button type="button" className="btn btn-ghost shrink-0" onClick={showPanel} style={{ fontSize: 12, padding: "3px 8px" }}>
          Show
        </button>
        <button type="button" className="btn btn-ghost shrink-0" onClick={() => setRepoName(null)} aria-label="Dismiss repo learn dock" style={{ fontSize: 12, padding: "3px 7px" }}>
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

function learnStatus({
  data,
  error,
  isLoading,
}: {
  data?: RepoLearnStatusPayload;
  error: unknown;
  isLoading: boolean;
}) {
  if (error) return "Needs attention";
  if (data?.ready) return "Ready";
  if (isLoading || !data) return "Generating...";
  return "Generating...";
}
