"use client";

import { useEffect, useRef } from "react";
import type { DbEngine } from "@/lib/db/types";

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Cmd/Ctrl+Enter. Given the selection when there is one, else the whole buffer. */
  onRun: (statement: string) => void;
  engine: DbEngine;
  /** Table → columns, fed to autocomplete so real names complete. */
  schema?: Record<string, string[]>;
  /** Schema names, so `blog.` offers that schema's tables. */
  schemas?: string[];
  /** What an unqualified name resolves to, so `posts` completes as `blog.posts`. */
  defaultSchema?: string;
  /** Whether Mongo write operations should appear in completion results. */
  canWrite?: boolean;
  readOnly?: boolean;
  placeholder?: string;
}

/**
 * The query editor.
 *
 * CodeMirror is loaded on mount rather than imported at the top of the module:
 * it is a few hundred kilobytes, and it should not be in the bundle for anyone
 * who opens `/db` to browse a table and never opens the Query tab.
 *
 * Mongo connections get the JSON mode — the command language there is a JSON
 * document or a shell shorthand, and SQL highlighting would be actively
 * misleading.
 *
 * Run-selection is the feature that makes a scratch buffer usable: select the
 * statement you want, press Cmd+Enter, and the rest of the buffer stays put.
 */
export function SqlEditor({
  value,
  onChange,
  onRun,
  engine,
  schema,
  schemas,
  defaultSchema,
  canWrite,
  readOnly,
  placeholder,
}: SqlEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<{
    destroy: () => void;
    state: { doc: { length: number; toString: () => string } };
    dispatch: (spec: { changes: { from: number; to: number; insert: string } }) => void;
  } | null>(null);

  // Held in refs so the editor is built once: rebuilding it on every keystroke
  // would lose the cursor, the undo history and the selection. Updated in an
  // effect rather than during render — a ref written while rendering is not a
  // guaranteed commit, and React's lint rule is right to refuse it.
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);

  useEffect(() => {
    onChangeRef.current = onChange;
    onRunRef.current = onRun;
  }, [onChange, onRun]);

  // Table previews, history and AI can replace the buffer from outside
  // CodeMirror. Compare first so the normal onChange echo after each keystroke
  // does not reset the selection or undo history.
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      const [
        { EditorView, keymap, placeholder: placeholderExt, lineNumbers, highlightActiveLine },
        { EditorState },
        { defaultKeymap, history, historyKeymap },
        { sql, PostgreSQL, SQLite },
        { json },
        { autocompletion, completionKeymap },
        { bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle },
      ] = await Promise.all([
        import("@codemirror/view"),
        import("@codemirror/state"),
        import("@codemirror/commands"),
        import("@codemirror/lang-sql"),
        import("@codemirror/lang-json"),
        import("@codemirror/autocomplete"),
        import("@codemirror/language"),
      ]);

      if (disposed || !host.current) return;

      const language =
        engine === "mongodb"
          ? json()
          : sql({
              dialect: engine === "sqlite" ? SQLite : PostgreSQL,
              // Schema-aware completion: the difference between an editor that
              // guesses and one that knows your column names.
              schema: schema ?? {},
              // `blog.` offers that schema's tables…
              ...(schemas?.length ? { schemas: schemas.map((s) => ({ label: s })) } : {}),
              // …and `posts` resolves without qualifying, the way it does in psql.
              ...(defaultSchema ? { defaultSchema } : {}),
              upperCaseKeywords: true,
            });

      const mongoCompletionSource = (context: {
        explicit: boolean;
        pos: number;
        state: { sliceDoc: (from: number, to: number) => string };
      }) => {
        const suggestions = mongoCompletionSuggestions(
          context.state.sliceDoc(0, context.pos),
          schema ?? {},
          Boolean(canWrite),
        );
        if (!suggestions && !context.explicit) return null;
        return suggestions ?? {
          from: context.pos,
          options: MONGO_ROOT_COMPLETIONS,
        };
      };

      const runCurrent = (v: { state: { doc: { toString: () => string }; selection: { main: { from: number; to: number } } } }) => {
        const { from, to } = v.state.selection.main;
        const doc = v.state.doc.toString();
        // A selection means "run just this"; no selection means the whole buffer.
        onRunRef.current(from === to ? doc : doc.slice(from, to));
        return true;
      };

      const state = EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          indentOnInput(),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          engine === "mongodb"
            ? autocompletion({ override: [mongoCompletionSource] })
            : autocompletion(),
          language,
          placeholderExt(placeholder ?? ""),
          EditorState.readOnly.of(Boolean(readOnly)),
          keymap.of([
            { key: "Mod-Enter", run: runCurrent, preventDefault: true },
            // Shift-Enter too: the muscle memory varies by which client the
            // person came from, and both are free.
            { key: "Shift-Enter", run: runCurrent, preventDefault: true },
            ...completionKeymap,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
          EditorView.theme({
            "&": { height: "100%", fontSize: "12.5px" },
            ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, monospace)" },
            "&.cm-focused": { outline: "none" },
            // CodeMirror's completion popup ships its own light palette, which
            // is a white box on a dark page. Drive it from the app's tokens so
            // it follows the theme like everything else.
            ".cm-tooltip": {
              border: "1px solid var(--border)",
              borderRadius: "6px",
              background: "var(--bg-elevated)",
              color: "var(--text)",
            },
            ".cm-tooltip.cm-tooltip-autocomplete > ul": {
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              fontSize: "12px",
              // Long column lists otherwise run off the pane.
              maxHeight: "16em",
              maxWidth: "min(28rem, 60vw)",
            },
            ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
              padding: "2px 6px",
            },
            ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
              background: "var(--accent)",
              // The accent is a strong fill in every preset, so the label needs
              // the paired foreground rather than the page's.
              color: "var(--accent-fg)",
            },
            ".cm-completionIcon": { opacity: 0.6 },
            ".cm-completionDetail": { color: "var(--text-muted)", fontStyle: "normal" },
          }),
        ],
      });

      const editor = new EditorView({ state, parent: host.current });
      view.current = editor;
    })();

    return () => {
      disposed = true;
      view.current?.destroy();
      view.current = null;
    };
    // Rebuilt only when the language or schema genuinely changes — `value` is
    // deliberately absent, because the editor owns the document after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, readOnly, placeholder, schema, schemas, defaultSchema, canWrite]);

  return <div className="db-editor" ref={host} />;
}

interface MongoCompletionOption {
  label: string;
  type: "class" | "function" | "keyword";
  detail?: string;
  apply?: string;
}

interface MongoCompletionResult {
  from: number;
  options: MongoCompletionOption[];
}

const MONGO_READ_OPERATIONS = [
  "find",
  "findOne",
  "aggregate",
  "countDocuments",
  "estimatedDocumentCount",
  "distinct",
  "listIndexes",
] as const;

const MONGO_WRITE_OPERATIONS = [
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "createIndex",
  "dropIndex",
  "drop",
] as const;

const MONGO_ROOT_COMPLETIONS: MongoCompletionOption[] = [
  { label: "db", type: "keyword", detail: "current database" },
];

/**
 * Complete the safe Mongo shell shorthand accepted by the server-side parser.
 * Collection names come from live `listCollections`; operations mirror the
 * parser allowlist and hide mutations when the active credentials are read-only.
 */
export function mongoCompletionSuggestions(
  textBeforeCursor: string,
  tables: Record<string, string[]>,
  canWrite: boolean,
): MongoCompletionResult | null {
  const operationMatch = textBeforeCursor.match(
    /db\s*\.\s*[A-Za-z_][\w$-]*\s*\.\s*([A-Za-z]*)$/,
  );
  if (operationMatch) {
    const prefix = operationMatch[1];
    const operations = canWrite
      ? [...MONGO_READ_OPERATIONS, ...MONGO_WRITE_OPERATIONS]
      : MONGO_READ_OPERATIONS;
    return {
      from: textBeforeCursor.length - prefix.length,
      options: operations.map((operation) => ({
        label: operation,
        type: "function",
        detail: MONGO_WRITE_OPERATIONS.includes(
          operation as (typeof MONGO_WRITE_OPERATIONS)[number],
        )
          ? "write"
          : "read",
        apply: `${operation}()`,
      })),
    };
  }

  const collectionMatch = textBeforeCursor.match(/db\s*\.\s*([A-Za-z_$][\w$-]*)?$/);
  if (collectionMatch) {
    const prefix = collectionMatch[1] ?? "";
    const collections = [...new Set(
      Object.keys(tables)
        .map((name) => name.slice(name.indexOf(".") + 1))
        // Dot shorthand cannot represent every legal Mongo collection name.
        // Those remain usable through db["name"], but suggesting invalid JS
        // after `db.` would be worse than omitting it.
        .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name)),
    )].sort();
    return {
      from: textBeforeCursor.length - prefix.length,
      options: collections.map((collection) => ({
        label: collection,
        type: "class",
        detail: "collection",
      })),
    };
  }

  const rootMatch = textBeforeCursor.match(/\b(d|db)$/);
  if (rootMatch) {
    return {
      from: textBeforeCursor.length - rootMatch[1].length,
      options: MONGO_ROOT_COMPLETIONS,
    };
  }

  return null;
}

/**
 * Build CodeMirror's schema map.
 *
 * Registered under both the qualified and the bare name, because people type
 * both — `blog.posts.` and, once `defaultSchema` is set, plain `posts.`.
 *
 * A bare name is only claimed by the *first* schema that has it. Two schemas
 * with a `posts` table would otherwise fight over the key, and silently
 * completing the wrong table's columns is worse than completing none: you would
 * not notice until the query failed, or worse, didn't.
 */
export function toCompletionSchema(
  tables: Record<string, string[]>,
  defaultSchema?: string,
): Record<string, string[]> {
  const schema: Record<string, string[]> = {};
  const claimed = new Set<string>();

  // Default schema first, so it wins the bare names it should.
  const keys = Object.keys(tables).sort((a, b) => {
    const aDefault = defaultSchema ? a.startsWith(`${defaultSchema}.`) : false;
    const bDefault = defaultSchema ? b.startsWith(`${defaultSchema}.`) : false;
    if (aDefault !== bDefault) return aDefault ? -1 : 1;
    return a.localeCompare(b);
  });

  for (const qualified of keys) {
    const columns = tables[qualified];
    schema[qualified] = columns;
    const bare = qualified.slice(qualified.indexOf(".") + 1);
    if (!claimed.has(bare)) {
      claimed.add(bare);
      schema[bare] = columns;
    }
  }

  return schema;
}
