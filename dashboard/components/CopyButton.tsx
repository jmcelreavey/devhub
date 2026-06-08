"use client";

import { useState, useCallback } from "react";
import { Check, ClipboardCopy } from "lucide-react";
import { useToast } from "@/lib/use-toast";

/**
 * Small ghost button that copies `text` to the clipboard with a brief
 * checkmark confirmation. Used across ops, datadog, status, etc.
 */
export function CopyButton({
  text,
  label,
  size = 12,
}: {
  text: string;
  label: string;
  size?: number;
}) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  }, [text, toast]);

  return (
    <button
      type="button"
      className="btn btn-ghost"
      style={{ padding: "4px 8px", fontSize: "11px" }}
      onClick={() => void copy()}
      title={`Copy ${label}`}
    >
      {copied ? (
        <Check size={size} style={{ color: "var(--success)" }} />
      ) : (
        <ClipboardCopy size={size} />
      )}
    </button>
  );
}
