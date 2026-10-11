import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const documents = ["README.md", "CHANGELOG.md", "CONTRIBUTING.md", "ROADMAP.md", "AGENTS.md"];
function collect(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(relative);
    else if (entry.isFile() && entry.name.endsWith(".md")) documents.push(relative);
  }
}
collect("docs");
const withoutCode = content => content.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "");
const anchors = new Map();
function headingAnchors(file) {
  if (anchors.has(file)) return anchors.get(file);
  const values = new Set();
  const occurrences = new Map();
  const content = withoutCode(fs.readFileSync(file, "utf8"));
  for (const match of content.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = match[1].toLowerCase().replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
    const count = occurrences.get(slug) ?? 0;
    occurrences.set(slug, count + 1);
    values.add(count ? `${slug}-${count}` : slug);
  }
  for (const match of content.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) values.add(match[1]);
  anchors.set(file, values);
  return values;
}
const failures = [];
let checked = 0;
for (const document of documents) {
  const content = withoutCode(fs.readFileSync(path.join(root, document), "utf8")).replace(/`[^`\n]*`/g, "");
  const links = [...content.matchAll(/!?\[[^\]\n]*\]\(<?([^\s)>]+)>?(?:\s+["'][^\n]*?["'])?\)/g), ...content.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm)];
  for (const match of links) {
    const target = match[1];
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
    if (target.startsWith("/") && !target.startsWith("/docs/")) continue;
    const [pathname, fragment] = target.split("#", 2);
    let resolved = pathname.startsWith("/docs/")
      ? path.join(root, "docs", pathname.slice(6).replace(/\.md$/, "") + ".md")
      : path.resolve(root, path.dirname(document), decodeURIComponent(pathname.split("?")[0] || path.basename(document)));
    if (!fs.existsSync(resolved) && fs.existsSync(resolved + ".md")) resolved += ".md";
    checked += 1;
    const line = content.slice(0, match.index).split("\n").length;
    if (!fs.existsSync(resolved)) failures.push(`${document}:${line}: missing ${target}`);
    else if (fragment && resolved.endsWith(".md") && !/^L\d/.test(fragment) && !headingAnchors(resolved).has(decodeURIComponent(fragment))) failures.push(`${document}:${line}: missing anchor ${target}`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
console.log(`Checked ${checked} local links in ${documents.length} documents; ${failures.length} failures.`);
