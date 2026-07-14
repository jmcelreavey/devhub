"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useBlockNoteEditor } from "@blocknote/react";
import { Code2 } from "lucide-react";
import { useTheme } from "@/components/ThemeToggle";

interface MermaidBlockViewProps {
  code: string;
  blockId: string;
}

export function MermaidBlockView({ code, blockId }: MermaidBlockViewProps) {
  const editor = useBlockNoteEditor();
  const editable = editor.isEditable;
  const { mode } = useTheme();
  const [editing, setEditing] = useState(!code && editable);
  const [draft, setDraft] = useState(code);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const renderId = useId().replace(/[^a-zA-Z0-9]/g, "");

  // Render whatever is actually on screen: the live draft while editing (so you
  // get instant feedback as you type), the saved code otherwise. Debounced
  // while editing to keep typing smooth.
  const source = editing ? draft : code;
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      void (async () => {
        if (!source.trim()) {
          if (!cancelled) {
            setSvg("");
            setError("");
          }
          return;
        }
        try {
          const mermaid = (await import("mermaid")).default;
          mermaid.initialize({ startOnLoad: false, theme: mode === "dark" ? "dark" : "default" });
          const { svg: out } = await mermaid.render(`mermaid-${renderId}`, source);
          if (!cancelled) {
            setSvg(out);
            setError("");
          }
        } catch (e) {
          if (!cancelled) {
            setSvg("");
            setError(e instanceof Error ? e.message : "Invalid diagram");
          }
        }
      })();
    };
    const handle = setTimeout(run, editing ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [source, editing, mode, renderId]);

  const startEditing = () => {
    setDraft(code);
    setEditing(true);
  };

  const save = () => {
    const block = editor.document.find((b) => b.id === blockId);
    if (block) editor.updateBlock(block, { props: { code: draft } });
    setEditing(false);
  };

  return (
    <div className="card my-1 overflow-hidden" contentEditable={false}>
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: "1px solid var(--border-muted)" }}
      >
        <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
          <Code2 size={13} aria-hidden /> Mermaid
        </span>
        {editable && (
          <button
            type="button"
            className="btn btn-ghost text-xs"
            style={{ padding: "2px 6px" }}
            onClick={() => (editing ? save() : startEditing())}
          >
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>
      {editing ? (
        <div className="p-2 space-y-2">
          <textarea
            className="input w-full font-mono text-xs"
            style={{ minHeight: 140, resize: "vertical" }}
            value={draft}
            placeholder={"graph TD\n  A[Start] --> B[End]"}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            autoFocus
          />
          <div style={{ borderTop: "1px solid var(--border-muted)", paddingTop: 8 }}>
            {error ? (
              <p className="text-xs" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            ) : svg ? (
              <MermaidSvg svg={svg} />
            ) : (
              <p className="text-xs" style={{ color: "var(--text-subtle)" }}>
                Preview updates as you type.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="p-3">
          {error ? (
            <p className="text-xs" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          ) : svg ? (
            <MermaidSvg svg={svg} />
          ) : (
            <p className="text-xs" style={{ color: "var(--text-subtle)" }}>
              Empty diagram - click Edit to add Mermaid syntax.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MermaidSvg({ svg }: { svg: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = svg;
  }, [svg]);
  return <div ref={ref} className="flex justify-center" />;
}
