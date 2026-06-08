import type { Editor } from "tldraw";

/** Export the current page of a tldraw editor as an SVG or PNG download. */
export async function exportDiagramImage(
  editor: Editor,
  format: "svg" | "png",
  filename: string,
): Promise<boolean> {
  const ids = [...editor.getCurrentPageShapeIds()];
  if (ids.length === 0) return false;

  const result = await editor.toImage(ids, { format, background: true, padding: 16 });
  if (!result?.blob) return false;

  const url = URL.createObjectURL(result.blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return true;
}
