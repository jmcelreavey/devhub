"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { isGitNoisePath } from "@/lib/repos/git-parsers";
import { fetchGitJson, repoApi, type StatusFile, type StatusPayload } from "./shared";

/**
 * Working-tree file list for the repo hub. Collapsed by default — Open Git
 * still owns staging; clicking a row selects that file in Changes.
 */
export function HubWorkingTree({
  repoName,
  tick = 0,
  onOpenFile,
}: {
  repoName: string;
  tick?: number;
  onOpenFile?: (path: string) => void;
}) {
  const [files, setFiles] = useState<StatusFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchGitJson<StatusPayload>(repoApi(repoName, "/git/status"))
      .then((json) => {
        if (!live) return;
        setFiles(json.files.filter((file) => !isGitNoisePath(file.path)));
        setError(null);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setError(err instanceof Error ? err.message : "Status failed");
      });
    return () => {
      live = false;
    };
  }, [repoName, tick]);

  const count = files?.length;

  return (
    <div className="repo-hub-working-tree">
      <button
        type="button"
        className="flex items-center gap-1 text-sm font-semibold text-text"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Local files
        {count != null ? <span className="repo-git-section-label-end">{count}</span> : null}
      </button>
      {open ? (
        error ? (
          <p className="text-xs text-danger mt-2">{error}</p>
        ) : !files ? (
          <div className="mt-2">
            <SkeletonRows count={4} height={22} />
          </div>
        ) : files.length === 0 ? (
          <p className="text-xs text-text-subtle mt-2">Working tree is clean.</p>
        ) : (
          <div className="repo-hub-working-tree-list mt-2">
            {files.map((file) => (
              <div key={file.path} className="repo-git-file-row">
                <button
                  type="button"
                  className="repo-git-file-main"
                  aria-label={`Open ${file.path} in git`}
                  onClick={() => onOpenFile?.(file.path)}
                >
                  <span className="repo-git-file-status">{file.status}</span>
                  <span className="truncate font-mono" title={file.path}>
                    {file.path}
                  </span>
                </button>
              </div>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
