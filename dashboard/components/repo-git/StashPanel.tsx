"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { SkeletonRows } from "@/components/SkeletonRows";
import { useConfirm, usePrompt } from "@/components/ConfirmDialog";
import { useToast } from "@/lib/use-toast";
import { agentStashMessageCommand, openTerminal } from "@/lib/terminal-launch";
import type { DiffLine } from "@/lib/repo-git-parsers";
import { GitDiffView } from "./GitDiffView";
import {
  fetchGitJson,
  IconBtn,
  postGitAction,
  readError,
  repoApi,
  type GitPanelHandlers,
} from "./shared";

interface StashEntry {
  ref: string;
  index: number;
  branch: string | null;
  message: string;
  detail: string;
}

export function StashPanel({
  repoName,
  repoPath,
  onMutate,
  onConflict,
}: Pick<GitPanelHandlers, "onMutate" | "onConflict"> & {
  repoName: string;
  repoPath: string;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [diffLoading, setDiffLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const json = await fetchGitJson<{ stashes: StashEntry[] }>(repoApi(repoName, "/git/stash"));
      const next = json.stashes ?? [];
      setStashes(next);
      setSelected((prev) => {
        if (prev && next.some((s) => s.ref === prev)) return prev;
        return next[0]?.ref ?? null;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Stash list failed");
    } finally {
      setLoading(false);
    }
  }, [repoName, toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch stash list on mount / repo change
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected) {
      setDiffLines([]); // eslint-disable-line react-hooks/set-state-in-effect -- clear stash preview when nothing selected
      return;
    }
    let cancelled = false;
    setDiffLines([]);
    setDiffLoading(true);
    void (async () => {
      try {
        const result = await postGitAction<{ lines: DiffLine[] }>(repoApi(repoName, "/git/stash"), {
          action: "show",
          ref: selected,
        });
        if (!result.ok) throw new Error(result.kind === "error" ? result.message : result.kind);
        if (!cancelled) setDiffLines(result.json.lines ?? []);
      } catch (err) {
        if (!cancelled) {
          setDiffLines([]);
          toast.error(err instanceof Error ? err.message : "Stash show failed");
        }
      } finally {
        if (!cancelled) setDiffLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, repoName, toast]);

  async function act(action: string, ref?: string, message?: string) {
    if (action === "drop" && ref) {
      const ok = await confirm({
        title: `Drop ${ref}?`,
        message: "This permanently removes the stash entry.",
        confirmLabel: "Drop",
        variant: "danger",
      });
      if (!ok) return;
    }
    setActing(action);
    try {
      const result = await postGitAction(repoApi(repoName, "/git/stash"), { action, ref, message });
      if (!result.ok) {
        if (result.kind === "conflict") {
          await onConflict(result.conflict);
          onMutate();
          await refresh();
          return;
        }
        throw new Error(result.kind === "error" ? result.message : result.kind);
      }
      toast.success(action === "save" ? "Stashed" : action === "pop" ? "Popped" : action === "apply" ? "Applied" : "Dropped");
      if (action !== "show") {
        setSelected(null);
        onMutate();
        await refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Stash action failed");
    } finally {
      setActing(null);
    }
  }

  async function draftStashMessage(): Promise<string> {
    const res = await fetch(repoApi(repoName, "/git/stash-message"), { method: "POST" });
    if (res.status === 503) {
      const ok = await confirm({
        title: "AI not configured in-app",
        message: "Hand off to your agent CLI to draft a stash description from the working tree?",
        confirmLabel: "Open agent",
      });
      if (ok) {
        openTerminal({
          cwd: repoPath,
          label: `stash msg · ${repoName}`,
          command: await agentStashMessageCommand(repoName),
        });
        throw new Error("Drafting in agent CLI — paste the result here when ready.");
      }
      throw new Error("AI not configured in-app");
    }
    if (!res.ok) throw new Error(await readError(res));
    const json = (await res.json()) as { message: string };
    if (!json.message?.trim()) throw new Error("AI returned an empty message");
    return json.message.trim();
  }

  async function saveNamed() {
    const message = await prompt({
      title: "Stash changes",
      message: "Optional message for this stash. Leave blank for git’s default WIP label.",
      input: {
        placeholder: "WIP before experiment",
        defaultValue: "",
        generateAi: {
          label: "Generate with AI",
          onGenerate: draftStashMessage,
        },
      },
      confirmLabel: "Stash",
    });
    if (message === null) return;
    await act("save", undefined, message.trim() || undefined);
  }

  if (loading && stashes.length === 0) return <SkeletonRows count={4} height={32} />;

  return (
    <div className="repo-git-stash">
      <div className="repo-git-changes-toolbar">
        <button type="button" className="btn btn-ghost" disabled={acting !== null} onClick={() => void saveNamed()}>
          <Download size={11} /> Stash working tree
        </button>
        <div className="repo-git-spacer" />
        <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
          {stashes.length} stash{stashes.length === 1 ? "" : "es"}
        </span>
      </div>
      <div className="repo-git-changes-grid">
        <div className="repo-git-file-cols">
          {stashes.length === 0 ? (
            <div className="repo-git-empty">No stashes — save a named WIP when you need a clean tree.</div>
          ) : (
            stashes.map((s) => (
              <div key={s.ref} className="repo-git-stash-row" data-active={selected === s.ref || undefined}>
                <button type="button" className="repo-git-stash-main" onClick={() => setSelected(s.ref)}>
                  <span className="font-mono" style={{ color: "var(--accent)" }}>{s.ref}</span>
                  <span className="truncate" title={s.message}>{s.message}</span>
                  {s.branch && <span className="repo-git-ref-chip">{s.branch}</span>}
                </button>
                <div className="repo-git-file-actions">
                  <IconBtn label="Apply" onClick={() => void act("apply", s.ref)} disabled={acting !== null}>
                    Apply
                  </IconBtn>
                  <IconBtn label="Pop" onClick={() => void act("pop", s.ref)} disabled={acting !== null}>
                    Pop
                  </IconBtn>
                  <IconBtn label="Drop" danger onClick={() => void act("drop", s.ref)} disabled={acting !== null}>
                    <Trash2 size={10} />
                  </IconBtn>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="repo-git-diff-pane">
          <div className="repo-git-diff-head">
            {selected ? <span className="font-mono">{selected}</span> : <span style={{ color: "var(--text-subtle)" }}>Select a stash to preview</span>}
          </div>
          <div key={selected ?? "none"} className="repo-git-diff-body">
            {diffLoading ? (
              <SkeletonRows count={6} height={14} />
            ) : (
              <GitDiffView lines={diffLines} emptyMessage="Empty stash or binary-only changes." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
