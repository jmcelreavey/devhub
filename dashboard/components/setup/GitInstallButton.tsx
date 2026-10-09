"use client";

import { useState } from "react";
import { MAC_GIT_INSTALL_FOLLOWUP } from "@/lib/setup/git-copy";

/** Starts Apple's installer. Nothing runs until this button is clicked. */
export function GitInstallButton() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function install() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/setup/git/install", { method: "POST" });
      const body = (await response.json()) as { ok?: boolean; message?: string; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || "Couldn't start the macOS installer.");
      setMessage(body.message || MAC_GIT_INSTALL_FOLLOWUP);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the macOS installer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" className="btn btn-primary" onClick={() => void install()} disabled={busy}>
        {busy ? "Opening the installer…" : "Install Git"}
      </button>
      {message && <p>{message}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
