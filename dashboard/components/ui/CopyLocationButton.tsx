"use client";

import { useCallback, useState } from "react";
import { Check, ClipboardCopy } from "lucide-react";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useToast } from "@/lib/hooks/use-toast";

/**
 * Copies a vault/MCP location string (notes_read / diagrams_read / docs_read path).
 * Icon-only or labelled button; checkmark + toast on success.
 */
export function CopyLocationButton({
  path,
  variant = "icon",
  size = 12,
  className,
  stopPropagation = false,
}: {
  /** Extensionless relative path as MCP tools expect it. */
  path: string;
  variant?: "icon" | "button";
  size?: number;
  className?: string;
  stopPropagation?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  const copy = useCallback(
    async (e?: { stopPropagation: () => void; preventDefault: () => void }) => {
      if (stopPropagation && e) {
        e.preventDefault();
        e.stopPropagation();
      }
      try {
        await copyTextToClipboard(path);
        setCopied(true);
        toast.success("Location copied");
        setTimeout(() => setCopied(false), 2000);
      } catch {
        toast.error("Could not copy to clipboard.");
      }
    },
    [path, stopPropagation, toast],
  );

  if (variant === "button") {
    return (
      <button
        type="button"
        className={className ?? "btn btn-ghost text-xs flex items-center gap-1 shrink-0"}
        onClick={() => void copy()}
        title={`Copy location: ${path}`}
      >
        {copied ? (
          <Check size={size} className="text-success" aria-hidden />
        ) : (
          <ClipboardCopy size={size} aria-hidden />
        )}
        {copied ? "Copied" : "Copy location"}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={
        className ??
        "shrink-0 rounded p-0.5 reveal-on-hover transition-opacity"
      }
      style={{ color: copied ? "var(--success)" : "var(--text-subtle)" }}
      onClick={(e) => void copy(e)}
      title={`Copy location: ${path}`}
    >
      {copied ? (
        <Check size={size} aria-hidden />
      ) : (
        <ClipboardCopy size={size} aria-hidden />
      )}
      <span className="sr-only">Copy location</span>
    </button>
  );
}
