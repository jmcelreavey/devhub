"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Edit3, Save, TerminalSquare, X } from "lucide-react";
import { useToast } from "@/lib/use-toast";
import { SyncButton } from "@/components/SyncButton";
import { SkeletonRows } from "@/components/SkeletonRows";
import {
  DEFAULT_CURSOR_AGENT_MODEL,
  getAgentCliConfig,
  saveAgentCliConfig,
  type AgentCli,
  type AgentCliConfig,
} from "@/lib/agent-cli-config";

interface OpencodeConfigResponse {
  exists: boolean;
  content: string;
  envNames: string[];
  unresolved: string[];
}

const MODEL_INPUT_STYLE = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  padding: "3px 8px",
  color: "var(--text)",
  fontSize: "11px",
  fontFamily: '"SFMono-Regular", Consolas, monospace',
  width: "180px",
  outline: "none",
} as const;

/**
 * Picks which CLI one-shot agent jobs (PR review, DX audit, labs, repo
 * upstart) are handed to, plus per-CLI model overrides. Stored in `.env.local`
 * via `/api/agent-cli` (1Password-backed managed keys) — see
 * `lib/agent-cli-env.ts`. The Cursor option only appears when `cursor-agent`
 * is installed.
 */
function AgentCliCard() {
  const [config, setConfig] = useState<AgentCliConfig | null>(null);
  const [cli, setCli] = useState<AgentCli>("opencode");
  const [opencodeModel, setOpencodeModel] = useState("");
  const [cursorModel, setCursorModel] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    void getAgentCliConfig(true).then((c) => {
      setConfig(c);
      setCli(c.cli);
      setOpencodeModel(c.opencodeModel);
      setCursorModel(c.cursorModel);
    });
  }, []);

  const dirty =
    !!config &&
    (cli !== config.cli ||
      opencodeModel.trim() !== config.opencodeModel ||
      (cursorModel.trim() || DEFAULT_CURSOR_AGENT_MODEL) !== config.cursorModel);

  const save = async () => {
    setSaving(true);
    try {
      const next = await saveAgentCliConfig({ cli, opencodeModel, cursorModel });
      setConfig(next);
      setCli(next.cli);
      setOpencodeModel(next.opencodeModel);
      setCursorModel(next.cursorModel);
      toast.success("Agent CLI settings saved to .env.local.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save agent CLI settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card mb-3" style={{ padding: "10px 14px" }}>
      <div className="flex items-center gap-2" style={{ marginBottom: "6px" }}>
        <TerminalSquare size={14} style={{ color: "var(--accent)" }} aria-hidden />
        <span className="font-medium text-sm" style={{ color: "var(--text)" }}>
          Agent CLI
        </span>
        {dirty && (
          <button
            onClick={() => void save()}
            disabled={saving}
            className="btn btn-primary"
            style={{ fontSize: "11px", padding: "3px 8px", marginLeft: "auto" }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        )}
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)", lineHeight: 1.5, marginBottom: "8px" }}>
        Which CLI handles one-shot terminal jobs (PR review, DX audit, labs, repo upstart). Both see
        the same skills and notes MCP via sync (<code>~/.cursor/skills</code>,{" "}
        <code>~/.cursor/mcp.json</code>). Saved to <code>.env.local</code> as{" "}
        <code>DEVHUB_AGENT_*</code> keys, so the 1Password <code>devhub</code> item can populate
        them like other managed config.
      </p>
      {!config ? (
        <div role="status" aria-label="Loading agent CLI settings">
          <SkeletonRows count={1} height={28} />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap" role="radiogroup" aria-label="Agent CLI">
            <label className="text-xs flex items-center gap-1" style={{ color: "var(--text)", cursor: "pointer" }}>
              <input
                type="radio"
                name="agent-cli"
                value="opencode"
                checked={cli === "opencode"}
                onChange={() => setCli("opencode")}
              />
              OpenCode
            </label>
            {config.cursorAgentInstalled && (
              <label className="text-xs flex items-center gap-1" style={{ color: "var(--text)", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="agent-cli"
                  value="cursor"
                  checked={cli === "cursor"}
                  onChange={() => setCli("cursor")}
                />
                Cursor CLI (cursor-agent)
              </label>
            )}
            {cli === "opencode" ? (
              <label className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                Model
                <input
                  type="text"
                  value={opencodeModel}
                  placeholder="opencode.json default"
                  onChange={(e) => setOpencodeModel(e.target.value)}
                  spellCheck={false}
                  style={MODEL_INPUT_STYLE}
                />
              </label>
            ) : (
              <label className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                Model
                <input
                  type="text"
                  value={cursorModel}
                  placeholder={DEFAULT_CURSOR_AGENT_MODEL}
                  onChange={(e) => setCursorModel(e.target.value)}
                  spellCheck={false}
                  style={MODEL_INPUT_STYLE}
                />
              </label>
            )}
          </div>
          <p className="text-xs" style={{ color: "var(--text-subtle)", lineHeight: 1.5, marginTop: "6px" }}>
            {cli === "opencode" ? (
              <>
                Model uses <code>provider/model</code> form (e.g.{" "}
                <code>cursor-acp/grok-4.3</code>); blank uses the shared{" "}
                <code>opencode.json</code> default below.
              </>
            ) : (
              <>
                Verify the model slug with <code>cursor-agent --help</code> or the{" "}
                <code>/model</code> picker; blank falls back to{" "}
                <code>{DEFAULT_CURSOR_AGENT_MODEL}</code>.
              </>
            )}
            {!config.cursorAgentInstalled && (
              <>
                {" "}
                Cursor CLI not detected — install <code>cursor-agent</code> to unlock the Cursor
                option.
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
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
      <AgentCliCard />

      <p className="text-xs" style={{ color: "var(--text-muted)", lineHeight: 1.5, marginBottom: "12px" }}>
        <code>opencode/shared/opencode.json</code> is the source of truth for OpenCode{" "}
        <strong style={{ color: "var(--text)" }}>model, small_model, provider and theme</strong>. Click{" "}
        <strong style={{ color: "var(--text)" }}>Sync OpenCode</strong> to write those keys into{" "}
        <code>~/.config/opencode/opencode.json</code> - the <code>mcp</code> block and anything OpenCode
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
