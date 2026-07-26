export const GAP_EXPLAINED_MARKER = "<!-- gap-explained -->";

export function stripGapMarker(text: string): string {
  return text.replace(GAP_EXPLAINED_MARKER, "").trim();
}

export function hasGapExplanation(text: string): boolean {
  return text.includes(GAP_EXPLAINED_MARKER);
}

export function gapExplanationForLearning(repoName: string, message: string): string {
  const body = stripGapMarker(message);
  return `# ${repoName} — learning gap\n\n${body}`;
}

export function tutorMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part) {
        return String(part.text);
      }
      return "";
    })
    .join("");
}
