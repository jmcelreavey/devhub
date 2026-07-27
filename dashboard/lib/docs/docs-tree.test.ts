import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "@/lib/docs/frontmatter";
import { parseMarkdown } from "@/lib/docs/markdown-ast";
import { getSectionMeta, ROOT_SECTION_ID, sectionIdForSlug } from "@/lib/docs/doc-sections";
import { DOC_ICON_NAMES } from "@/components/docs/doc-icons";

/**
 * Integrity checks against the real `docs/` tree.
 *
 * These are cheap (48 small files) and catch the two failures that silently
 * degrade the docs site: a relative link that no longer resolves after a file
 * move, and a page with no frontmatter — which renders with a filename-derived
 * title and no card description.
 */

const DOCS_ROOT = path.resolve(__dirname, "../../../docs");

function walk(dir: string, prefix = ""): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .flatMap((entry) => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return walk(path.join(dir, entry.name), rel);
      return entry.name.endsWith(".md") ? [rel.replace(/\.md$/, "")] : [];
    });
}

const slugs = walk(DOCS_ROOT).sort();
const known = new Set(slugs);

function read(slug: string): string {
  return fs.readFileSync(path.join(DOCS_ROOT, `${slug}.md`), "utf8");
}

describe("docs tree", () => {
  it("has docs to check", () => {
    expect(slugs.length).toBeGreaterThan(10);
  });

  it("gives every doc a title and description", () => {
    const missing = slugs.filter((slug) => {
      const { frontmatter } = parseFrontmatter(read(slug));
      return !frontmatter.title || !frontmatter.description;
    });
    expect(missing).toEqual([]);
  });

  it("only uses icons the renderer can resolve", () => {
    const unknown = slugs
      .map((slug) => [slug, parseFrontmatter(read(slug)).frontmatter.icon] as const)
      .filter(([, icon]) => icon && !DOC_ICON_NAMES.includes(icon))
      .map(([slug, icon]) => `${slug}: ${icon}`);
    expect(unknown).toEqual([]);
  });

  it("puts every doc in a known section", () => {
    const unknown = slugs.filter((slug) => {
      const { frontmatter } = parseFrontmatter(read(slug));
      const id = frontmatter.section ?? sectionIdForSlug(slug);
      return id !== ROOT_SECTION_ID && getSectionMeta(id).description === "";
    });
    expect(unknown).toEqual([]);
  });

  it("resolves every relative link to another doc", () => {
    const broken: string[] = [];
    for (const slug of slugs) {
      const { body } = parseFrontmatter(read(slug));
      const fromDir = slug.includes("/") ? slug.slice(0, slug.lastIndexOf("/")) : "";
      for (const link of parseMarkdown(body).links) {
        const target = link.href.split("#")[0];
        if (!target) continue;
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
        if (target.startsWith("/")) continue;
        if (!target.endsWith(".md")) continue;

        const resolved = path.posix.normalize(path.posix.join(fromDir, target));
        // Links that leave the docs tree (../CONTRIBUTING.md) are checked
        // against the filesystem instead of the slug set.
        if (resolved.startsWith("..")) {
          const abs = path.resolve(DOCS_ROOT, fromDir, target);
          if (!fs.existsSync(abs)) broken.push(`${slug} -> ${link.href}`);
          continue;
        }
        if (!known.has(resolved.replace(/\.md$/, ""))) broken.push(`${slug} -> ${link.href}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("resolves every cross-doc anchor to a real heading", () => {
    const headings = new Map<string, Set<string>>();
    for (const slug of slugs) {
      const { body } = parseFrontmatter(read(slug));
      const ids = new Set<string>();
      for (const node of parseMarkdown(body).nodes) {
        if (node.type === "heading") ids.add(node.id);
      }
      headings.set(slug, ids);
    }

    const broken: string[] = [];
    for (const slug of slugs) {
      const { body } = parseFrontmatter(read(slug));
      const fromDir = slug.includes("/") ? slug.slice(0, slug.lastIndexOf("/")) : "";
      for (const link of parseMarkdown(body).links) {
        const [target, hash] = link.href.split("#");
        if (!hash) continue;
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;

        const targetSlug = target
          ? path.posix.normalize(path.posix.join(fromDir, target)).replace(/\.md$/, "")
          : slug;
        const ids = headings.get(targetSlug);
        // Links out of the docs tree are covered by the file-existence test.
        if (!ids) continue;
        if (!ids.has(hash)) broken.push(`${slug} -> ${link.href}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("resolves every curated `related` entry", () => {
    const broken: string[] = [];
    for (const slug of slugs) {
      const { frontmatter } = parseFrontmatter(read(slug));
      for (const entry of frontmatter.related ?? []) {
        const target = entry.replace(/\.md$/, "");
        if (!known.has(target)) broken.push(`${slug} -> ${entry}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
