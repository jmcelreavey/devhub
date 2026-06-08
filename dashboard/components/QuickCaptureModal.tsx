"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, ListTodo, StickyNote } from "lucide-react";
import { ModalShell } from "@/components/ModalShell";
import { textToBlocks } from "@/lib/markdown-convert";
import { slugify } from "@/lib/slugify";
import { todayISO } from "@/lib/utils";
import { useToast } from "@/lib/use-toast";

type CaptureKind = "task" | "note" | "learning";

export interface QuickCaptureModalProps {
  open: boolean;
  onClose: () => void;
  defaultKind?: CaptureKind;
}

const KINDS: { id: CaptureKind; label: string; Icon: typeof ListTodo }[] = [
  { id: "task", label: "Task", Icon: ListTodo },
  { id: "note", label: "Note", Icon: StickyNote },
  { id: "learning", label: "Learning", Icon: BookOpen },
];

export function QuickCaptureModal({ open, onClose, defaultKind = "task" }: QuickCaptureModalProps) {
  const toast = useToast();
  const [kind, setKind] = useState<CaptureKind>(defaultKind);
  const [text, setText] = useState("");
  const [path, setPath] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const resetAndClose = useCallback(() => {
    setText("");
    setPath("");
    setKind(defaultKind);
    onClose();
  }, [defaultKind, onClose]);

  const save = useCallback(async () => {
    const body = text.trim();
    if (!body || saving) return;
    setSaving(true);
    try {
      if (kind === "task") {
        const r = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: body }) });
        if (!r.ok) throw new Error("Could not create task.");
        toast.success("Task captured.");
      } else if (kind === "note") {
        const notePath = path.trim() || `inbox/${todayISO()}-${slugify(body.slice(0, 32), { fallback: "capture" })}`;
        const r = await fetch(`/api/notes/${notePath}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: textToBlocks(body) }) });
        if (!r.ok) throw new Error("Could not create note.");
        toast.success(`Note saved to ${notePath}`);
      } else {
        const fullPath = (path.trim() || `inbox/${slugify(body.split("\n")[0] ?? "learning", { fallback: "learning" })}`).replace(/^learnings\//, "");
        const title = body.split("\n")[0] ?? "Learning";
        const markdown = body.startsWith("#") ? body : `# ${title}\n\n${body}`;
        const r = await fetch(`/api/notes/learnings/${fullPath}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: textToBlocks(markdown) }) });
        if (!r.ok) throw new Error("Could not save learning.");
        toast.success(`Learning saved to learnings/${fullPath}`);
      }
      resetAndClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Capture failed.");
    } finally {
      setSaving(false);
    }
  }, [kind, text, path, saving, toast, resetAndClose]);

  const pathPlaceholder = kind === "note" ? `inbox/${todayISO()}-…` : kind === "learning" ? "inbox/topic-name" : "";

  return (
    <ModalShell
      open={open}
      onClose={resetAndClose}
      title="Quick capture"
      align="top"
      footer={
        <div className="flex justify-between items-center">
          <span className="text-[11px]" style={{ color: "var(--text-subtle)" }}>⌘⇧C to open · ⌘↵ to save</span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost text-xs" onClick={resetAndClose}>Cancel</button>
            <button type="button" className="btn btn-primary text-xs" disabled={saving || !text.trim()} onClick={() => void save()}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      }
    >
      <div className="-m-4 flex flex-col">
        <div className="flex gap-1 p-2 mx-4" style={{ borderBottom: "1px solid var(--border-muted)" }}>
          {KINDS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setKind(id)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium"
              style={{ background: kind === id ? "var(--accent-dim)" : "transparent", color: kind === id ? "var(--accent)" : "var(--text-muted)" }}
            >
              <Icon size={13} />{label}
            </button>
          ))}
        </div>
        <div className="p-4 flex flex-col gap-3">
          {kind !== "task" && (
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={pathPlaceholder}
              className="w-full px-3 py-2 rounded text-sm"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
          )}
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } }}
            rows={5}
            placeholder={kind === "task" ? "What needs doing?" : kind === "note" ? "Note content…" : "What should future-you remember?"}
            className="w-full px-3 py-2 rounded text-sm resize-none"
            style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
        </div>
      </div>
    </ModalShell>
  );
}
