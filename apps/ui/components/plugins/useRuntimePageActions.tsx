"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@/lib/navigation";
import { ModalShell } from "@/components/shell/ModalShell";
import { copyTextToClipboard } from "@/lib/clipboard";
import { PageActionError, pageActionSchema, type PageAction } from "../../../../packages/shared/ui-lib/plugins/runtime-page-contract";

interface Confirmation { action: PageAction; resolve: (value: boolean) => void }

export function useRuntimePageActions(name: string, page: string, revision: string) {
  const router = useRouter();
  const pending = useRef<Confirmation | null>(null);
  const openedTab = useRef<Window | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  useEffect(() => () => { pending.current?.resolve(false); pending.current = null; }, [name, page, revision]);

  const request = useCallback(async (input: unknown, signal: AbortSignal): Promise<unknown> => {
    const action = pageActionSchema.parse(input);
    const endpoint = `/api/plugins/runtime/${encodeURIComponent(name)}/browser`;
    const check = async (create = false) => {
      const response = await fetch(endpoint + (create ? "?create=1" : ""), {
        method: "POST", headers: { "Content-Type": "application/json" }, signal,
        body: JSON.stringify({ page, revision, action }),
      });
      const value = await response.json();
      if (!response.ok) throw new PageActionError(value.error?.message ?? "Page action unavailable");
      return value;
    };
    await check();
    if (signal.aborted) throw new Error("Cancelled");
    if (action.kind === "preference") {
      if (action.value === null) localStorage.removeItem(action.key);
      else if (action.value !== undefined) localStorage.setItem(action.key, action.value);
      return { value: localStorage.getItem(action.key) };
    }
    if (action.kind === "navigate") {
      router.push(`/plugins/runtime/${encodeURIComponent(name)}?page=${encodeURIComponent(action.path)}`);
      return null;
    }
    if (pending.current) throw new Error("Finish the current browser action first");
    const accepted = await new Promise<boolean>(resolve => {
      const item: Confirmation = { action, resolve };
      pending.current = item;
      setConfirmation(item);
      const abort = () => resolve(false);
      signal.addEventListener("abort", abort, { once: true });
      item.resolve = value => { signal.removeEventListener("abort", abort); resolve(value); };
      if (signal.aborted) item.resolve(false);
    });
    const popup = openedTab.current;
    openedTab.current = null;
    pending.current = null;
    setConfirmation(null);
    if (!accepted || signal.aborted) throw new Error("Cancelled");
    // The confirmation can outlive a disable or replacement in another process.
    try {
      const result = await check(action.kind === "createNote");
      if (signal.aborted) throw new Error("Cancelled");
      if (action.kind === "clipboard") await copyTextToClipboard(action.text);
      else if (action.kind === "external") {
        if (!popup) throw new Error("The browser blocked the new tab");
        popup.location.replace(action.href);
      } else if (action.kind === "createNote") router.push(result.href);
      return result;
    } catch (error) { popup?.close(); throw error; }
  }, [name, page, revision, router]);

  const action = confirmation?.action;
  const dialog = <ModalShell open={!!confirmation} title={action?.kind === "clipboard" ? "Copy plugin text" : action?.kind === "external" ? "Open evidence link" : "Create today's note"} onClose={() => confirmation?.resolve(false)}>
    <p className="text-sm">{action?.kind === "clipboard" ? "Copy this text to your clipboard?" : action?.kind === "external" ? "Open this address in a new tab?" : "Create today's note from this template? An existing note will be kept."}</p>
    <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-elevated p-3 text-xs">{action?.kind === "clipboard" ? action.text : action?.kind === "external" ? action.href : action?.kind === "createNote" ? action.markdown : ""}</pre>
    <div className="mt-4 flex gap-2"><button className="btn btn-primary" onClick={() => {
      if (confirmation?.action.kind === "external") {
        // Reserve a tab during the real click; navigate only after the final snapshot check.
        const popup = window.open("about:blank", "_blank");
        if (popup) popup.opener = null;
        openedTab.current = popup;
      }
      confirmation?.resolve(true);
    }}>{action?.kind === "clipboard" ? "Copy text" : action?.kind === "external" ? "Open link" : "Create note"}</button><button className="btn btn-ghost" onClick={() => confirmation?.resolve(false)}>Cancel</button></div>
  </ModalShell>;
  return { request, dialog };
}
