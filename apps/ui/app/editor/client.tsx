"use client";

import Link from "@/lib/navigation";
import { useRouter, useSearchParams } from "@/lib/navigation";
import { useEffect, useState } from "react";
import { copyTextToClipboard } from "@/lib/clipboard";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";

interface PairingCode {
  code: string;
  expiresAt: number;
}

export function EditorPairing({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [pair, setPair] = useState<PairingCode | null>(null);
  const [pending, setPending] = useState<"pair" | "revoke" | null>(null);
  const [failure, setFailure] = useState("");
  const [message, setMessage] = useState("");

  async function act(action: "pair" | "revoke") {
    if (pending) return;
    setPending(action);
    setFailure("");
    setMessage("");
    try {
      const response = await fetch("/api/editor/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, revoke: action === "revoke" }),
      });
      const result = await response.json() as { code?: string; expiresAt?: number; error?: string };
      if (!response.ok) throw new Error(result.error || "Editor action failed.");
      if (action === "pair") {
        if (!result.code || !result.expiresAt) throw new Error("Pairing code unavailable.");
        setPair({ code: result.code, expiresAt: result.expiresAt });
      } else {
        setPair(null);
        setMessage("Pairing revoked. Pending selections from this workspace were removed.");
      }
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Editor action failed.");
    } finally {
      setPending(null);
    }
  }

  async function copyCode() {
    if (!pair) return;
    try {
      await copyTextToClipboard(pair.code);
      setMessage("Pairing code copied.");
    } catch {
      setFailure("Clipboard unavailable.");
    }
  }

  return (
    <section className="card card-body" aria-label="Editor pairing">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">Pair Cursor or VS Code with {workspaceId}</h3>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
      <p className="mt-2 text-xs text-text-muted">
        Install the DevHub Selection add-on, then pair this workspace. Captured selections open here for review and Send to AI.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" disabled={pending !== null} onClick={() => void act("pair")}>
          {pending === "pair" ? "Creating code…" : "Create pairing code"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={pending !== null} onClick={() => void act("revoke")}>
          {pending === "revoke" ? "Revoking…" : "Revoke pairing"}
        </button>
      </div>
      {pair ? (
        <div className="tone-panel tone-panel--muted mt-3 text-xs">
          <p>Run <strong>DevHub: Pair this Workspace</strong> in your editor and paste the code. Expires {new Date(pair.expiresAt).toLocaleTimeString()}.</p>
          <button type="button" className="btn btn-ghost mt-2" onClick={() => void copyCode()}>Copy pairing code</button>
        </div>
      ) : null}
      {failure ? <p role="alert" className="tone-panel tone-panel--warning mt-3">{failure}</p> : null}
      {message ? <p role="status" className="tone-panel tone-panel--muted mt-3">{message}</p> : null}
      <Link className="mt-3 text-xs text-accent hover:underline" href="/docs/guides/editor">Add-on setup and platform notes</Link>
    </section>
  );
}

export default function EditorRedirect() {
  const params = useSearchParams();
  const router = useRouter();
  const selectionId = params.get("selection");
  const workspaceId = params.get("workspace");
  const [failure, setFailure] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!selectionId) {
      router.replace(workspaceId ? `/repos/${encodeURIComponent(workspaceId)}/git?tab=changes` : "/repos");
      return;
    }
    const controller = new AbortController();
    void fetch(`/api/editor/incoming?id=${encodeURIComponent(selectionId)}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { selection?: { workspaceId?: string }; error?: string };
        if (!response.ok) throw new Error(result.error || "Selection unavailable.");
        if (!result.selection?.workspaceId) throw new Error("Selection has no workspace.");
        router.replace(`/repos/${encodeURIComponent(result.selection.workspaceId)}/git?tab=changes&selection=${encodeURIComponent(selectionId)}`);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setFailure(cause instanceof Error ? cause.message : "Selection unavailable.");
      });
    return () => controller.abort();
  }, [router, selectionId, workspaceId, retry]);

  return (
    <div className="page-wrapper">
      {failure ? (
        <>
          <FetchError message={failure} onRetry={() => { setFailure(""); setRetry((value) => value + 1); }} />
          <Link className="btn btn-ghost mt-3" href="/repos">Open Repos</Link>
        </>
      ) : <SkeletonRows count={3} height={44} />}
    </div>
  );
}
