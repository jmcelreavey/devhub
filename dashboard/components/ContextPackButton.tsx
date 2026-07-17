"use client";

import { useState } from "react";
import { Package, Check } from "lucide-react";
import { copyContextPackToClipboard } from "@/lib/context-pack-client";
import { useToast } from "@/lib/use-toast";

export function ContextPackButton() {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyPack() {
    if (loading) return;
    setLoading(true);
    try {
      const ok = await copyContextPackToClipboard(toast);
      if (ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className="btn btn-ghost"
      style={{ fontSize: 12, padding: "4px 10px" }}
      onClick={() => void copyPack()}
      disabled={loading}
      aria-busy={loading}
      title="Copy tasks, learnings, daily note, and standup for AI sessions"
    >
      {copied ? <Check size={12} /> : <Package size={12} />}
      {loading ? "Building" : "Context pack"}
    </button>
  );
}
