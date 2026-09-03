"use client";

import { useCallback, useEffect, useState } from "react";
import { FileSearch, X } from "lucide-react";
import { useToast } from "@/lib/hooks/use-toast";
import { FieldError } from "@/components/ui/FieldError";
import { formatBytes, postDbAction } from "./shared";
import type { DbEngine } from "@/lib/db/types";

interface DiscoveredFile {
  file: string;
  repo: string;
  relativePath: string;
  sizeBytes: number;
}

interface AddConnectionDialogProps {
  onClose: () => void;
  onSaved: () => void;
  initial?: EditableDbConnection;
}

export interface EditableDbConnection {
  slug: string;
  label: string;
  engine: DbEngine;
  group?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  hasPassword?: boolean;
  ssl?: boolean;
  uri?: string;
  file?: string;
  readOnly?: boolean;
}

/**
 * Adding a connection by hand.
 *
 * SQLite leads, and the repo scan is offered before the file field, because the
 * fastest path to a working connection on a fresh install is "the database
 * already in your checkout" — not typing a path.
 *
 * Read-only is the default and has to be turned off deliberately. A hand-added
 * connection has no AWS profile to derive access from, so the choice is the
 * user's; making the safe one the default means pointing this at production by
 * mistake is survivable.
 */
export function AddConnectionDialog({ onClose, onSaved, initial }: AddConnectionDialogProps) {
  const toast = useToast();
  const [engine, setEngine] = useState<DbEngine>(initial?.engine ?? "sqlite");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [file, setFile] = useState(initial?.file ?? "");
  const [uri, setUri] = useState(initial?.uri ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 5432));
  const [database, setDatabase] = useState(initial?.database ?? "");
  const [user, setUser] = useState(initial?.user ?? "");
  const [password, setPassword] = useState("");
  const [ssl, setSsl] = useState(initial?.ssl ?? true);
  const [readOnly, setReadOnly] = useState(initial?.readOnly ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [discovered, setDiscovered] = useState<DiscoveredFile[] | null>(null);
  const [discovering, setDiscovering] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const discover = useCallback(async () => {
    setDiscovering(true);
    try {
      const res = await fetch("/api/db/discover");
      const data = (await res.json()) as { files: DiscoveredFile[] };
      setDiscovered(data.files ?? []);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDiscovering(false);
    }
  }, [toast]);

  const save = useCallback(async () => {
    setError(null);
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Give the connection a name.");
      return;
    }

    setSaving(true);
    const response = await postDbAction("/api/db/connections/manage", {
      slug: initial?.slug ?? slugify(trimmed),
      label: trimmed,
      engine,
      readOnly,
      ...(engine === "sqlite" ? { file: file.trim() } : {}),
      ...(engine === "mongodb" ? { uri: uri.trim(), database: database.trim() || undefined } : {}),
      ...(engine === "postgres"
        ? {
            host: host.trim(),
            port: Number(port) || 5432,
            database: database.trim() || undefined,
            user: user.trim() || undefined,
            password: password || undefined,
            ssl,
          }
        : {}),
    }, { method: "PUT" });
    setSaving(false);

    if (!response.ok) {
      setError(response.message);
      return;
    }
    toast.success(initial ? `Updated ${trimmed}.` : `Added ${trimmed}.`);
    onSaved();
  }, [
    initial, label, engine, readOnly, file, uri, host, port, database, user, password, ssl, toast, onSaved,
  ]);

  return (
    <div className="db-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="db-dialog card"
        role="dialog"
        aria-modal="true"
        aria-label={initial ? "Edit database connection" : "Add a database connection"}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="card-header db-dialog-head">
          <h2>{initial ? "Edit connection" : "Add a connection"}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </header>

        <div className="card-body db-dialog-body">
          <label className="db-field">
            <span>Engine</span>
            <select
              className="input"
              value={engine}
              onChange={(e) => setEngine(e.target.value as DbEngine)}
              disabled={Boolean(initial)}
            >
              <option value="sqlite">SQLite</option>
              <option value="postgres">PostgreSQL</option>
              <option value="mongodb">MongoDB</option>
            </select>
          </label>

          <label className="db-field">
            <span>Name</span>
            <input
              className="input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="insider-app cache"
              autoFocus
            />
          </label>

          {engine === "sqlite" && (
            <>
              <label className="db-field">
                <span>Database file</span>
                <input
                  className="input"
                  value={file}
                  onChange={(e) => setFile(e.target.value)}
                  placeholder="/Users/you/Developer/app/dev.db"
                />
              </label>

              <button type="button" className="btn btn-ghost" onClick={() => void discover()}>
                <FileSearch size={13} aria-hidden />
                {discovering ? "Scanning repos…" : "Find databases in my repos"}
              </button>

              {discovered && discovered.length === 0 && (
                <p className="db-dialog-note">No SQLite files found in your tracked repos.</p>
              )}
              {discovered && discovered.length > 0 && (
                <ul className="db-discovered">
                  {discovered.slice(0, 40).map((found) => (
                    <li key={found.file}>
                      <button
                        type="button"
                        className="db-discovered-row"
                        onClick={() => {
                          setFile(found.file);
                          if (!label.trim()) setLabel(`${found.repo} · ${basename(found.relativePath)}`);
                        }}
                      >
                        <span className="db-discovered-repo">{found.repo}</span>
                        <span className="db-discovered-path">{found.relativePath}</span>
                        <span className="db-discovered-size">{formatBytes(found.sizeBytes)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {engine === "mongodb" && (
            <>
              <label className="db-field">
                <span>Connection URI</span>
                <input
                  className="input"
                  value={uri}
                  onChange={(e) => setUri(e.target.value)}
                  placeholder="mongodb://localhost:27017"
                />
              </label>
              <label className="db-field">
                <span>Database</span>
                <input
                  className="input"
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  placeholder="admin"
                />
              </label>
            </>
          )}

          {engine === "postgres" && (
            <>
              <div className="db-field-row">
                <label className="db-field">
                  <span>Host</span>
                  <input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" />
                </label>
                <label className="db-field db-field--narrow">
                  <span>Port</span>
                  <input className="input" value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
                </label>
              </div>
              <label className="db-field">
                <span>Database</span>
                <input className="input" value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="postgres" />
              </label>
              <div className="db-field-row">
                <label className="db-field">
                  <span>User</span>
                  <input className="input" value={user} onChange={(e) => setUser(e.target.value)} placeholder="postgres" />
                </label>
                <label className="db-field">
                  <span>Password</span>
                  <input
                    className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={initial?.hasPassword ? "Leave blank to keep the saved password" : undefined}
                  />
                </label>
              </div>
              <label className="db-checkbox">
                <input type="checkbox" checked={ssl} onChange={(e) => setSsl(e.target.checked)} />
                <span>Use TLS</span>
              </label>
            </>
          )}

          <label className="db-checkbox">
            <input
              type="checkbox"
              checked={readOnly}
              onChange={(e) => setReadOnly(e.target.checked)}
            />
            <span>
              Read-only
              <em>
                {" "}
                — the engine itself refuses writes. Turn this off only if you mean to change data.
              </em>
            </span>
          </label>

          {error && <FieldError>{error}</FieldError>}
        </div>

        <footer className="card-body db-dialog-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : initial ? "Save changes" : "Add connection"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Same slug rule the API enforces, so the client fails before the round trip. */
function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return slug || `conn-${Date.now().toString(36)}`;
}

function basename(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}
