"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, Plus, Search, X } from "lucide-react";
import { FileTree } from "@/components/FileTree";
import { ResizeHandle } from "@/components/ResizeHandle";
import { createPersistedBoolStore } from "@/lib/use-persisted-bool";
import { useIsMobile } from "@/lib/use-is-mobile";
import { getVaultClient } from "@/lib/vault/vault-client";
import type { VaultId } from "@/lib/vault/vault-client";

const DEFAULT_WIDTH = 208;
const MIN_WIDTH = 180;
const MAX_WIDTH = 480;
const COLLAPSED_WIDTH = 44;

function readStoredWidth(key: string): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const stored = localStorage.getItem(key);
  const n = stored ? Number(stored) : DEFAULT_WIDTH;
  if (!Number.isFinite(n)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
}

function subscribeStoredWidth(eventName: string, callback: () => void): () => void {
  window.addEventListener(eventName, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(eventName, callback);
    window.removeEventListener("storage", callback);
  };
}

export function VaultFilesSidebar({
  vault: vaultId,
  search,
  onSearch,
  onNew,
}: {
  vault: VaultId;
  search: string;
  onSearch: (q: string) => void;
  onNew: () => void;
}) {
  const vault = getVaultClient(vaultId);
  const collapsedKey = `${vaultId}-files-sidebar-collapsed`;
  const widthKey = `${vaultId}-files-sidebar-width`;
  const storageEvent = `devhub:${vaultId}-files-sidebar-storage`;
  const usePersistedBool = createPersistedBoolStore(storageEvent);

  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = usePersistedBool(collapsedKey, isMobile);
  const subscribeWidth = useCallback(
    (callback: () => void) => subscribeStoredWidth(storageEvent, callback),
    [storageEvent],
  );
  const storedWidth = useSyncExternalStore(
    subscribeWidth,
    () => readStoredWidth(widthKey),
    () => DEFAULT_WIDTH,
  );
  const [resizingWidth, setResizingWidth] = useState<number | null>(null);
  const dragging = useRef(false);
  const expandedWidth = resizingWidth ?? storedWidth;
  const expandedWidthRef = useRef(expandedWidth);

  useEffect(() => {
    expandedWidthRef.current = expandedWidth;
  }, [expandedWidth]);

  const width = collapsed ? COLLAPSED_WIDTH : expandedWidth;
  const toggle = () => setCollapsed((prev) => !prev);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startWidth = expandedWidthRef.current;

      const shield = document.createElement("div");
      shield.style.cssText = "position:fixed;inset:0;z-index:var(--z-shield);cursor:col-resize;";
      document.body.appendChild(shield);

      let nextWidth = startWidth;
      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        nextWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX)));
        setResizingWidth(nextWidth);
      };
      const onUp = () => {
        dragging.current = false;
        localStorage.setItem(widthKey, String(nextWidth));
        window.dispatchEvent(new Event(storageEvent));
        setResizingWidth(null);
        shield.remove();
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      shield.addEventListener("mousemove", onMove);
      shield.addEventListener("mouseup", onUp);
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [storageEvent, widthKey],
  );

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r overflow-hidden"
      style={{
        width,
        minWidth: width,
        background: "var(--bg-surface)",
        borderColor: "var(--border)",
        transition: "none",
      }}
    >
      {collapsed ? (
        <div className="flex flex-1 min-h-0 flex-col items-center py-2 gap-1">
          <button
            type="button"
            onClick={onNew}
            className="flex items-center justify-center rounded p-1.5"
            style={{ color: "var(--accent)" }}
            title={`New ${vault.itemLabel}`}
            aria-label={`New ${vault.itemLabel}`}
          >
            <Plus size={14} strokeWidth={2.5} aria-hidden />
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                FILES
              </span>
              <button
                type="button"
                onClick={onNew}
                className="text-xs px-1.5 py-0.5 rounded"
                style={{ color: "var(--accent)", background: "var(--bg-elevated)" }}
                title={`New ${vault.itemLabel}`}
              >
                <Plus size={12} aria-hidden />
              </button>
            </div>
            <div className="px-2 pb-2">
              <div
                className="flex items-center gap-1.5 px-2 py-1 rounded"
                style={{ background: "var(--bg-elevated)" }}
              >
                <Search size={11} style={{ color: "var(--text-subtle)", flexShrink: 0 }} />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => onSearch(e.target.value)}
                  placeholder="Search…"
                  className="bg-transparent border-none outline-none text-xs w-full"
                  style={{ color: "var(--text)" }}
                />
                {search ? (
                  <button type="button" onClick={() => onSearch("")} style={{ color: "var(--text-subtle)" }}>
                    <X size={10} aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
            <FileTree vault={vaultId} search={search} />
          </div>
        </div>
      )}

      {!collapsed && !isMobile ? (
        <ResizeHandle
          axis="e"
          onMouseDown={handleResizeStart}
          title="Drag to resize"
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: 6,
            zIndex: 10,
          }}
        />
      ) : null}

      <div
        className="shrink-0 flex items-center justify-center border-t"
        style={{ borderColor: "var(--border)" }}
      >
        <button
          type="button"
          onClick={toggle}
          className="sidebar-collapse-btn"
          title={collapsed ? "Expand files panel" : "Collapse files panel"}
          aria-label={collapsed ? "Expand files panel" : "Collapse files panel"}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
}
