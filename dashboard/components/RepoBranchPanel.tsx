"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, CornerDownLeft, GitBranch, RotateCw } from "lucide-react";
import { useToast } from "@/lib/use-toast";
import type { BranchesApiPayload } from "@/app/repos/types";

interface RepoBranchPanelProps {
  repoName: string;
  onMutate: () => void;
}

export function RepoBranchPanel({ repoName, onMutate }: RepoBranchPanelProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<BranchesApiPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const toast = useToast();
  const panelRef = useRef<HTMLDivElement>(null);

  async function fetchBranches() {
    setLoading(true);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(repoName)}/branches`);
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as BranchesApiPayload;
      setData(json);
    } catch (err) {
      toast.error(`Couldn't load branches: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function handleOpen() {
    setOpen(true);
    fetchBranches();
  }

  async function act(action: string, branch?: string) {
    setActing(action);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(repoName)}/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, branch }),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => "Unknown error");
        throw new Error(err);
      }
      toast.success(action === "checkout" ? `Switched to ${branch}` : action === "stash-save" ? "Changes stashed" : "Stash applied");
      await fetchBranches();
      onMutate();
    } catch (err) {
      toast.error(`${err instanceof Error ? err.message : "Action failed"}`);
    } finally {
      setActing(null);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={handleOpen} className="btn btn-ghost" style={{ fontSize: "12px", padding: "3px 8px" }}>
        <GitBranch size={12} /> Branches
        <ChevronDown size={10} aria-hidden />
      </button>
    );
  }

  return (
    <div ref={panelRef} className="relative inline-flex">
      <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost" style={{ fontSize: "12px", padding: "3px 8px" }}>
        <GitBranch size={12} /> Branches
        <ChevronUp size={10} aria-hidden />
      </button>

      <div
        className="absolute left-0 top-full z-50 mt-2 w-80 border rounded shadow-xl"
        style={{ borderColor: "var(--border)", background: "var(--bg-surface)", maxHeight: 320, overflow: "hidden auto" }}
      >
        {loading && !data ? (
          <div className="p-3 text-xs" style={{ color: "var(--text-muted)" }}>Loading branches...</div>
        ) : !data ? (
          <div className="p-3 text-xs" style={{ color: "var(--danger)" }}>Failed to load branches</div>
        ) : (
          <div>
            <div className="p-2 flex items-center gap-2 border-b" style={{ borderColor: "var(--border)" }}>
              {data.hasChanges && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: "11px", padding: "2px 6px" }}
                  disabled={acting !== null}
                  onClick={() => act("stash-save")}
                >
                  {acting === "stash-save" ? "Stashing..." : "Stash"}
                </button>
              )}
              {data.stashCount > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: "11px", padding: "2px 6px" }}
                  disabled={acting !== null}
                  onClick={() => act("stash-apply")}
                >
                  {acting === "stash-apply" ? "Applying..." : `Apply stash (${data.stashCount})`}
                </button>
              )}
              {!data.hasChanges && data.stashCount === 0 && (
                <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
                  Clean working tree, no stashes
                </span>
              )}
              {acting === "checkout" && <RotateCw size={11} className="animate-spin" />}
            </div>

            <div>
              {data.branches.map((b) => (
                <button
                  key={b.name}
                  type="button"
                  className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs hover:opacity-80"
                  style={{
                    background: b.current ? "var(--accent-bg, rgba(99,102,241,0.08))" : "transparent",
                    color: "var(--text)",
                    cursor: b.current ? "default" : "pointer",
                    opacity: acting === `checkout-${b.name}` ? 0.5 : 1,
                  }}
                  disabled={b.current || acting !== null}
                  onClick={() => act("checkout", b.name)}
                >
                  {b.current ? (
                    <Check size={12} style={{ color: "var(--accent)" }} />
                  ) : (
                    <CornerDownLeft size={12} style={{ color: "var(--text-subtle)" }} />
                  )}
                  <span style={{ fontWeight: b.current ? 600 : 400 }}>{b.name}</span>
                  {b.current && (
                    <span className="text-xs ml-auto" style={{ color: "var(--accent)" }}>current</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
