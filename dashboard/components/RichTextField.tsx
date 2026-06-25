"use client";

import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { blocknoteDashboardTheme } from "@/lib/blocknote-dashboard-theme";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/core/style.css";
import "@blocknote/mantine/style.css";

export interface RichTextFieldProps {
  /** Receives the editor contents as Markdown on every change. */
  onChangeMarkdown: (markdown: string) => void;
}

/**
 * Small WYSIWYG editor (default BlockNote) for short rich text such as a Jira
 * description. Emits Markdown so the server can turn it into Jira ADF. Bold,
 * italic, code, links, headings and lists are supported via the formatting
 * toolbar (select text) and the "/" slash menu.
 */
export function RichTextField({ onChangeMarkdown }: RichTextFieldProps) {
  const editor = useCreateBlockNote({ animations: false });

  return (
    <div
      className="rich-text-field rounded-md"
      style={{
        border: "1px solid var(--border-muted)",
        background: "var(--bg)",
        minHeight: 96,
      }}
    >
      <BlockNoteView
        editor={editor}
        theme={blocknoteDashboardTheme}
        onChange={() => {
          Promise.resolve(editor.blocksToMarkdownLossy(editor.document)).then((md) =>
            onChangeMarkdown(md.trimEnd()),
          );
        }}
      />
    </div>
  );
}
