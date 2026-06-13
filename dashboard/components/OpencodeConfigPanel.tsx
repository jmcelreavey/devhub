"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Edit3, Save, X } from "lucide-react";
import { useToast } from "@/lib/use-toast";
import { SyncButton } from "@/components/SyncButton";
import { SkeletonRows } from "@/components/SkeletonRows";

interface OpencodeConfigResponse {
  exists: boolean;
  content: string;
  envNames: string[];
  unresolved: string[];
}

export function OpencodeConfigPanel() {
  const [data, setData] = useState<OpencodeConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const reload = useCallback(() => {
    return fetch("/api/opencode")
      .then((r) => r.json())
      .then((d: OpencodeConfigResponse) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/opencode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      const body = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(body.error ?? "Save failed");
      setEditing(false);
      toast.success("Saved opencode/shared/opencode.json.");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }, [editContent, reload, toast]);

  const unresolved = data?.unresolved ?? [];
  const envNames = data?.envNames ?? [];

  return (
    <>
      <p className="text-xs" style={{ color: "var(--text-muted)", lineHeight: 1.5, marginBottom: "12px" }}>
        <code>opencode/shared/opencode.json</code> is the source of truth for OpenCode{" "}
        <strong style={{ color: "var(--text)" }}>model, small_model, provider and theme</strong>. Click{" "}
        <strong style={{ color: "var(--text)" }}>Sync OpenCode</strong> to write those keys into{" "}
        <code>~/.config/opencode/opencode.json</code> — the <code>mcp</code> block and anything OpenCode
        manages itself are left untouched, so its model catalogue keeps auto-updating. Provider API keys
        are stored as <code>{"{env:VAR}"}</code> placeholders (never raw secrets) and resolved from your
        environment, which the 1Password <code>devhub</code> item populates.
      </p>

      {data && (
        <div
          className="card mb-3"
          style={{
            padding: "10px 14px",
            display: "flex",
            alignItems: "flex-start",
            gap: "8px",
            borderColor: unresolved.length ? "var(--danger)" : "var(--border)",
          }}
        >
          {unresolved.length ? (
            <AlertTriangle size={14} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 2 }} aria-hidden />
          ) : (
            <CheckCircle2 size={14} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} aria-hidden />
          )}
          <div className="text-xs" style={{ color: "var(--text-muted)", lineHeight: 1.5 }}>
            {envNames.length === 0 ? (
              <>No <code>{"{env:VAR}"}</code> secret references in the shared config.</>
            ) : unresolved.length ? (
              <>
                <strong style={{ color: "var(--text)" }}>{unresolved.length} secret(s) unresolved:</strong>{" "}
                <code>{unresolved.join(", ")}</code>. Add matching fields to your 1Password{" "}
                <code>devhub</code> item (or <code>.env.local</code>), run <code>op signin</code>, then Sync.
                Sync still writes everything else; unresolved keys stay as <code>{"{env:VAR}"}</code>.
              </>
            ) : (
              <>All {envNames.length} secret reference(s) resolve from the current environment.</>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <SyncButton
          script="sync_opencode_config"
          label="Sync OpenCode"
          successMessage="OpenCode config synced (mcp + other keys preserved)."
          onComplete={() => void reload()}
        />
        <SyncButton
          script="collect_opencode_config"
          label="Collect from local"
          successMessage="Local OpenCode config imported (secrets scrubbed to {env:VAR})."
          onComplete={() => void reload()}
        />
      </div>

      {loading && (
        <div role="status" aria-label="Loading OpenCode config">
          <SkeletonRows count={2} height={56} />
        </div>
      )}

      {!loading && data && (
        <div className="card" style={{ padding: 0 }}>
          <div
            className="w-full flex items-center gap-2"
            style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)" }}
          >
            <span className="font-medium text-sm font-mono flex-1" style={{ color: "var(--text)" }}>
              opencode/shared/opencode.json
            </span>
            {data.exists &&
              (editing ? (
                <>
                  <button
                    onClick={() => setEditing(false)}
                    className="btn btn-ghost"
                    style={{ fontSize: "11px", padding: "3px 8px", display: "flex", alignItems: "center", gap: "4px" }}
                  >
                    <X size={10} /> Cancel
                  </button>
                  <button
                    onClick={() => void save()}
                    disabled={saving}
                    className="btn btn-primary"
                    style={{ fontSize: "11px", padding: "3px 8px", display: "flex", alignItems: "center", gap: "4px" }}
                  >
                    <Save size={10} /> {saving ? "Saving..." : "Save"}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    setEditContent(data.content);
                    setEditing(true);
                  }}
                  className="btn btn-ghost"
                  style={{ fontSize: "11px", padding: "3px 8px", display: "flex", alignItems: "center", gap: "4px" }}
                  title="Edit the shared OpenCode config"
                >
                  <Edit3 size={10} /> Edit
                </button>
              ))}
          </div>
          <div style={{ padding: "12px 14px" }}>
            {!data.exists ? (
              <p className="text-xs" style={{ color: "var(--text-subtle)" }}>
                No <code>opencode/shared/opencode.json</code> yet. Use{" "}
                <strong>Collect from local</strong> to seed it from this machine&apos;s OpenCode config
                (secrets are scrubbed automatically).
              </p>
            ) : editing ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                spellCheck={false}
                style={{
                  width: "100%",
                  minHeight: "360px",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  padding: "12px",
                  color: "var(--text)",
                  fontSize: "12px",
                  fontFamily: '"SFMono-Regular", Consolas, monospace',
                  lineHeight: 1.5,
                  outline: "none",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            ) : (
              <pre
                className="text-xs overflow-x-auto whitespace-pre-wrap"
                style={{
                  color: "var(--text-muted)",
                  fontFamily: '"SFMono-Regular", Consolas, monospace',
                  maxHeight: "480px",
                  overflowY: "auto",
                  lineHeight: 1.5,
                }}
              >
                {data.content}
              </pre>
            )}
          </div>
        </div>
      )}
    </>
  );
}
