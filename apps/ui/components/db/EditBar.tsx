"use client";

import { useState } from "react";
import { AlertTriangle, Check, Eye, Undo2 } from "lucide-react";
import { dbApi, postDbAction } from "./shared";

interface EditBarProps {
  connectionId: string;
  connectionLabel: string;
  dangerous: boolean;
  namespace: string;
  table: string;
  payload: { updates: unknown[]; deletes: unknown[] };
  count: number;
  onDiscard: () => void;
  onApplied: () => void;
}

/**
 * Staged changes, and the two things you can do with them.
 *
 * Preview is not decoration. These statements were built server-side from a row
 * identity the user never sees, so "show me exactly what you are about to run"
 * is the only way they can check the WHERE clause targets what they think it
 * does — which is the whole risk of editing through a grid.
 */
export function EditBar({
  connectionId,
  connectionLabel,
  dangerous,
  namespace,
  table,
  payload,
  count,
  onDiscard,
  onApplied,
}: EditBarProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [needsConfirm, setNeedsConfirm] = useState(false);

  const body = { namespace, table, ...payload };

  // Plain functions rather than callbacks: both run only from a click, and
  // memoising them would mean keying a dep list on the staged-change payload,
  // which is a new object on every keystroke anyway.
  async function showPreview() {
    setBusy(true);
    setError(null);
    const response = await postDbAction<{ preview: string }>(dbApi(connectionId, "/rows"), {
      ...body,
      preview: true,
    });
    setBusy(false);
    if (response.ok) setPreview(response.json.preview);
    else setError(response.message);
  }

  async function apply() {
    setBusy(true);
    setError(null);
    const response = await postDbAction<{ summary: string }>(dbApi(connectionId, "/rows"), {
      ...body,
      confirm: confirm || undefined,
    });
    setBusy(false);

    if (response.ok) {
      setPreview(null);
      setConfirm("");
      setNeedsConfirm(false);
      onApplied();
      return;
    }

    setError(response.message);
    // A confirmation failure is a prompt, not a dead end — show the field.
    if (response.kind === "confirm") setNeedsConfirm(true);
  }

  return (
    <div className={`db-edit-bar tone-panel ${dangerous ? "tone-panel--danger" : "tone-panel--warning"}`}>
      <div className="db-edit-row">
        <strong>
          {count} unsaved change{count === 1 ? "" : "s"}
        </strong>
        {dangerous && (
          <span className="badge badge-danger">
            <AlertTriangle size={11} aria-hidden /> production
          </span>
        )}
        <div className="db-edit-actions">
          <button type="button" className="btn btn-ghost" onClick={() => void showPreview()} disabled={busy}>
            <Eye size={13} aria-hidden /> Preview SQL
          </button>
          <button type="button" className="btn btn-ghost" onClick={onDiscard} disabled={busy}>
            <Undo2 size={13} aria-hidden /> Discard
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void apply()}
            disabled={busy || (needsConfirm && confirm.trim() !== connectionLabel)}
          >
            <Check size={13} aria-hidden /> {busy ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>

      {preview && (
        <pre className="db-edit-preview">{preview}</pre>
      )}

      {needsConfirm && (
        <div className="db-edit-confirm">
          <p>
            Type <code>{connectionLabel}</code> to apply these changes to production.
          </p>
          <input
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={connectionLabel}
            aria-label="Type the connection name to confirm"
          />
        </div>
      )}

      {error && !needsConfirm && <p className="db-edit-error">{error}</p>}
    </div>
  );
}
