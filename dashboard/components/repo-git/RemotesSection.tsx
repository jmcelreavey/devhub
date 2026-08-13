"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useConfirm, usePrompt } from "@/components/shell/ConfirmDialog";
import { useToast } from "@/lib/hooks/use-toast";
import { isSafeRemoteName, isSafeRemoteUrl, type Remote } from "@/lib/repos/remote-parsers";
import { fetchGitJson, repoApi } from "./shared";

interface RemotesPayload {
  remotes: Remote[];
  upstream: string | null;
  linkRemote: string | null;
}

/**
 * Remote management, under the branch lists.
 *
 * `origin` used to be assumed everywhere, which quietly ruled out the whole
 * fork-based workflow: `origin` is your fork, `upstream` is the repo you cannot
 * push to, and neither adding the second remote nor choosing between them was
 * possible from the UI.
 */
export function RemotesSection({
  repoName,
  onMutate,
}: {
  repoName: string;
  onMutate: () => void;
}) {
  const toast = useToast();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const [data, setData] = useState<RemotesPayload | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await fetchGitJson<RemotesPayload>(repoApi(repoName, "/git/remotes")));
    } catch {
      // A repo with no remotes is normal, and this section is supplementary —
      // failing it should not disturb the branch lists above.
    }
  }, [repoName]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load on mount / repo change
    void refresh();
  }, [refresh]);

  const post = useCallback(
    async (body: Record<string, unknown>, success: string) => {
      setActing(String(body.name ?? body.action));
      try {
        const res = await fetch(repoApi(repoName, "/git/remotes"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed");
        toast.success(success);
        await refresh();
        onMutate();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      } finally {
        setActing(null);
      }
    },
    [repoName, toast, refresh, onMutate],
  );

  const addRemote = useCallback(async () => {
    const name = await prompt({
      title: "Add a remote",
      message: "Short name, e.g. `upstream` for the repo your fork came from.",
      input: { placeholder: "upstream" },
      confirmLabel: "Next",
    });
    if (!name?.trim()) return;
    if (!isSafeRemoteName(name)) {
      toast.error("Remote names can only contain letters, numbers, dot, dash and underscore.");
      return;
    }
    const url = await prompt({
      title: `URL for ${name.trim()}`,
      message: "An https or ssh git URL.",
      input: { placeholder: "git@github.com:org/repo.git" },
      confirmLabel: "Add remote",
    });
    if (!url?.trim()) return;
    if (!isSafeRemoteUrl(url)) {
      toast.error("That doesn't look like a git URL.");
      return;
    }
    // Fetched server-side on add, so its branches show up straight away.
    await post({ action: "add", name: name.trim(), url: url.trim() }, `Added ${name.trim()}`);
  }, [prompt, toast, post]);

  const editUrl = useCallback(
    async (remote: Remote) => {
      const url = await prompt({
        title: `URL for ${remote.name}`,
        input: { defaultValue: remote.fetchUrl },
        confirmLabel: "Save",
      });
      if (!url?.trim() || url.trim() === remote.fetchUrl) return;
      if (!isSafeRemoteUrl(url)) {
        toast.error("That doesn't look like a git URL.");
        return;
      }
      await post({ action: "set-url", name: remote.name, url: url.trim() }, "URL updated");
    },
    [prompt, toast, post],
  );

  const removeRemote = useCallback(
    async (remote: Remote) => {
      const ok = await confirm({
        title: `Remove the ${remote.name} remote?`,
        message:
          "Local branches tracking it lose their upstream. Nothing is deleted on the remote itself.",
        confirmLabel: "Remove",
        variant: "danger",
      });
      if (!ok) return;
      await post({ action: "remove", name: remote.name }, `Removed ${remote.name}`);
    },
    [confirm, post],
  );

  const remotes = data?.remotes ?? [];

  return (
    <>
      <div className="repo-git-branch-hint" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>Remotes</span>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: "2px 6px" }}
          disabled={acting !== null}
          onClick={() => void addRemote()}
        >
          <Plus size={10} /> Add
        </button>
      </div>
      <div className="repo-git-branch-list">
        {remotes.length === 0 && (
          <div className="repo-git-empty-sm">
            No remotes. Add one to push, pull, or open this repo on the web.
          </div>
        )}
        {remotes.map((remote) => (
          <div key={remote.name} className="repo-git-branch-row">
            <div className="repo-git-branch-main" style={{ cursor: "default" }}>
              <Link2 size={12} className="text-text-subtle" />
              <span style={{ fontWeight: 500 }}>{remote.name}</span>
              {data?.linkRemote === remote.name && (
                <span
                  className="repo-git-ref-chip"
                  title="Web links and the current branch's upstream point here"
                >
                  in use
                </span>
              )}
              {remote.pushUrl !== remote.fetchUrl && (
                <span className="repo-git-ref-chip" data-tone="warning" title={remote.pushUrl}>
                  separate push URL
                </span>
              )}
              <span className="truncate text-text-subtle" title={remote.fetchUrl}>
                {remote.fetchUrl}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-ghost repo-git-icon-btn"
              aria-label={`Change the URL for ${remote.name}`}
              title={`Change the URL for ${remote.name}`}
              disabled={acting !== null}
              onClick={() => void editUrl(remote)}
            >
              {acting === remote.name ? (
                <RefreshCw size={10} className="animate-spin" />
              ) : (
                <Pencil size={10} />
              )}
            </button>
            <button
              type="button"
              className="btn btn-ghost repo-git-icon-btn"
              data-danger
              aria-label={`Remove remote ${remote.name}`}
              disabled={acting !== null}
              onClick={() => void removeRemote(remote)}
            >
              <Trash2 size={10} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
