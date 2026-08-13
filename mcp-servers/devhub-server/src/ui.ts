/**
 * The seam for returning *rendered* results, not just text.
 *
 * ## What this is for
 *
 * Every DevHub tool currently answers with `{ type: "text" }`, so a task list
 * arrives as markdown a model re-reads and re-formats, and a PR queue arrives
 * as prose the user cannot click. MCP-UI clients can render an HTML resource
 * inline instead, which turns those answers into something you interact with
 * rather than something you scroll past.
 *
 * ## Why this is a seam and not a rollout
 *
 * Client support is uneven, and a tool that returns only a UI resource is
 * broken in every client that doesn't render it. So `uiResult()` always emits
 * the text first and attaches the resource beside it. Non-supporting clients
 * see exactly what they see today; supporting clients get the widget. That
 * ordering is the entire compatibility story, and it is why the text argument
 * is required rather than optional — making it easy to omit would guarantee
 * somebody eventually ships a tool that renders nowhere.
 *
 * One tool (`tasks_today`) is wired as proof. The rest stay text until this has
 * been used against a real client, because converting twenty tools to a
 * rendering contract nobody has exercised is how you end up with twenty tools
 * to revise.
 *
 * ## Security
 *
 * The HTML is built here from DevHub's own data and returned as a self-contained
 * document with no network access, no script tags and no external references.
 * Everything interpolated goes through `escapeHtml`. An MCP client renders this
 * in *its* trust context, so a widget that could be steered by note content
 * would be a content-injection vector into the client — hence escaping at the
 * boundary rather than trusting inputs.
 */

export interface UiResource {
  type: "resource";
  resource: {
    uri: string;
    mimeType: string;
    text: string;
  };
}

export type TextContent = { type: "text"; text: string };
export type ToolContent = TextContent | UiResource;

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  /**
   * The MCP SDK types a tool result as an open record so servers can attach
   * `_meta` and future fields. Without this index signature a structurally
   * identical object is rejected at the `registerTool` boundary.
   */
  [key: string]: unknown;
}

/** Escape for interpolation into HTML text or a quoted attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Whether to attach UI resources at all.
 *
 * Off unless `DEVHUB_MCP_UI=1`. A capability the user has not opted into should
 * not change what their existing tools return, and this ships ahead of being
 * exercised against a real client.
 */
export function uiEnabled(): boolean {
  return process.env.DEVHUB_MCP_UI === "1";
}

/**
 * A tool result carrying both a text answer and an optional rendered view.
 *
 * `text` is not optional. Every client can read it; only some can render the
 * resource, and a result that is empty without rendering support is a bug that
 * only shows up on someone else's machine.
 */
export function uiResult(text: string, html: string | null, uri: string): ToolResult {
  const content: ToolContent[] = [{ type: "text", text }];

  if (html && uiEnabled()) {
    content.push({
      type: "resource",
      resource: { uri, mimeType: "text/html", text: html },
    });
  }

  return { content };
}

/**
 * Wrap widget markup in a self-contained document.
 *
 * Styling is inline and theme-agnostic via `prefers-color-scheme`: the widget
 * renders inside a host whose theme we cannot query, so it has to look
 * deliberate on either background rather than assume one.
 */
export function widgetDocument(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font: 13px/1.5 ui-sans-serif, -apple-system, "Segoe UI", sans-serif;
    margin: 0; padding: 12px;
    background: transparent;
    color: #1f2328;
  }
  @media (prefers-color-scheme: dark) { body { color: #e6edf3; } }
  h2 { font-size: 13px; margin: 0 0 8px; letter-spacing: .01em; }
  ul { list-style: none; margin: 0; padding: 0; }
  li {
    display: flex; gap: 8px; align-items: baseline;
    padding: 6px 8px; border-radius: 6px;
    border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
    margin-bottom: 4px;
  }
  .meta { opacity: .6; font-size: 11px; margin-left: auto; white-space: nowrap; }
  .done { opacity: .5; text-decoration: line-through; }
  .empty { opacity: .6; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}
