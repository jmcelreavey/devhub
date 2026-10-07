"use client";

import { useState, useCallback } from "react";
import { Check, ClipboardCopy } from "lucide-react";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useToast } from "@/lib/hooks/use-toast";

/**
 * Small ghost button that copies `text` to the clipboard with a brief
 * checkmark confirmation. Used across ops, datadog, status, etc.
 */
export function CopyButton({
  text,
  label,
  size = 12,
  showLabel = false,
}: {
  text: string;
  label: string;
  size?: number;
  /** Spell out "Copy <label>" next to the icon instead of relying on the tooltip. */
  showLabel?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  const copy = useCallback(async () => {
    try {
      await copyTextToClipboard(text);
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
      aria-label={showLabel ? undefined : `Copy ${label}`}
    >
      {copied ? (
        <Check size={size} className="text-success" />
      ) : (
        <ClipboardCopy size={size} />
      )}
      {showLabel && <span className="ml-1.5">{copied ? "Copied" : `Copy ${label}`}</span>}
    </button>
  );
}
