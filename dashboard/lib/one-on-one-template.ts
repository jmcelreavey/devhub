/** Insert a bullet under a `## Heading` section (after existing content in that section). */
export function insertUnderHeading(md: string, heading: string, bullet: string): string {
  const lines = md.split("\n");
  const needle = `## ${heading}`;
  const start = lines.findIndex((l) => l.trim() === needle);
  if (start === -1) {
    return `${md.trimEnd()}\n\n${needle}\n${bullet}\n`;
  }
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end += 1;

  for (let i = start + 1; i < end; i++) {
    const t = lines[i].trim();
    if (t === "-" || t === "- [ ]") {
      lines[i] = bullet;
      return lines.join("\n");
    }
  }

  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === "") insertAt -= 1;
  lines.splice(insertAt, 0, bullet);
  return lines.join("\n");
}
