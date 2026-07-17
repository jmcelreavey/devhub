"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { SkeletonRows } from "@/components/SkeletonRows";
import { useToast } from "@/lib/use-toast";
import { fetchGitJson, repoApi } from "./shared";

interface BlameLine {
  hash: string;
  author: string;
  date: string;
  lineNumber: number;
  content: string;
}

interface BlameHistoryEntry {
  shortHash: string;
  subject: string;
  author: string;
  relativeDate: string;
}

export function BlamePanel({ repoName }: { repoName: string }) {
  const toast = useToast();
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState<BlameLine[]>([]);
  const [history, setHistory] = useState<BlameHistoryEntry[]>([]);

  async function load(target?: string) {
    const filePath = (target ?? path).trim();
    if (!filePath) {
      toast.error("Enter a file path");
      return;
    }
    setLoading(true);
    try {
      const json = await fetchGitJson<{ lines: BlameLine[]; history: BlameHistoryEntry[] }>(
        repoApi(repoName, `/git/blame?path=${encodeURIComponent(filePath)}`),
      );
      setLines(json.lines ?? []);
      setHistory(json.history ?? []);
      setPath(filePath);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Blame failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="repo-git-blame">
      <form
        className="repo-git-changes-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <input
          className="input"
          style={{ fontSize: 12, flex: 1, minWidth: 0 }}
          placeholder="path/to/file.ts"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? <RefreshCw size={11} className="animate-spin" /> : "Blame"}
        </button>
      </form>
      {history.length > 0 && (
        <div className="repo-git-blame-history">
          {history.slice(0, 8).map((h) => (
            <div key={h.shortHash} className="repo-git-blame-history-row">
              <span className="font-mono" style={{ color: "var(--accent)" }}>{h.shortHash}</span>
              <span className="truncate">{h.subject}</span>
              <span style={{ color: "var(--text-subtle)" }}>{h.relativeDate}</span>
            </div>
          ))}
        </div>
      )}
      {loading && lines.length === 0 ? (
        <SkeletonRows count={10} height={16} />
      ) : lines.length === 0 ? (
        <div className="repo-git-empty">Enter a tracked file path to see blame and history.</div>
      ) : (
        <div className="repo-git-blame-table">
          {lines.map((l) => (
            <div key={`${l.lineNumber}-${l.hash}`} className="repo-git-blame-line">
              <span className="repo-git-blame-meta font-mono" title={`${l.author} · ${l.date}`}>
                {l.hash}
              </span>
              <span className="repo-git-blame-author truncate">{l.author}</span>
              <span className="repo-git-blame-num">{l.lineNumber}</span>
              <code className="repo-git-blame-code">{l.content}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
