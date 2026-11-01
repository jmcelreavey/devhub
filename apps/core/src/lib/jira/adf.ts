/** Flatten ADF (or plain string) description to plain text. */
export function adfToPlainText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return "";
  const obj = node as { type?: string; text?: string; content?: unknown[] };
  if (typeof obj.text === "string") return obj.text;
  if (!Array.isArray(obj.content)) return "";
  const parts = obj.content.map(adfToPlainText);
  // Block nodes separate with newlines; inline runs concatenate.
  const block = obj.type === "doc" || obj.type === "bulletList" || obj.type === "orderedList" || obj.type === "blockquote";
  return parts.join(block ? "\n" : "");
}
