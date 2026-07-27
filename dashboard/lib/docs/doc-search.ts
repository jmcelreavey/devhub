/**
 * Full-text search over the docs tree.
 *
 * Built from the same parsed AST the pages render, so a hit always maps to a
 * real heading and can deep-link to it. Deliberately not an inverted index: 48
 * documents is small enough that a linear scan with a scoring pass is instant,
 * and an index would be one more thing to invalidate on every save.
 *
 * Scoring, highest first: title match, heading match, then body frequency.
 * Ties break on section order so "Installation" beats an archived plan that
 * happens to mention installing.
 */

import { getDocIndex, getDocSearchCorpus } from "@/lib/docs/doc-index";
import type { DocSearchHit, DocSearchSection } from "@/lib/docs/doc-search-types";

const MAX_SNIPPET = 160;

function normalise(value: string): string {
  return value.toLowerCase();
}

/** Split a query into terms; quoted spans stay together. */
export function parseQuery(raw: string): string[] {
  const terms: string[] = [];
  const pattern = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    const term = (match[1] ?? match[2]).trim().toLowerCase();
    if (term.length >= 2) terms.push(term);
  }
  return terms;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

/**
 * A window of text around the first match, with word boundaries respected so
 * snippets do not start mid-word.
 */
function buildSnippet(text: string, term: string): string | null {
  const at = normalise(text).indexOf(term);
  if (at === -1) return null;
  const start = Math.max(0, at - Math.floor((MAX_SNIPPET - term.length) / 2));
  const end = Math.min(text.length, start + MAX_SNIPPET);
  let slice = text.slice(start, end);
  if (start > 0) slice = `…${slice.replace(/^\S*\s/, "")}`;
  if (end < text.length) slice = `${slice.replace(/\s\S*$/, "")}…`;
  return slice.trim();
}

export function searchDocs(rawQuery: string, limit = 20): DocSearchHit[] {
  const terms = parseQuery(rawQuery);
  if (terms.length === 0) return [];

  const index = getDocIndex();
  const corpus = getDocSearchCorpus();
  const hits: DocSearchHit[] = [];

  for (const doc of index.docs) {
    if (doc.draft) continue;
    const entry = corpus.get(doc.slug);
    if (!entry) continue;

    const title = normalise(doc.title);
    const description = normalise(doc.description ?? "");
    const tags = doc.tags.map(normalise);

    let score = 0;
    let matchedAll = true;

    for (const term of terms) {
      let termScore = 0;
      if (title.includes(term)) termScore += title === term ? 200 : 100;
      if (doc.slug.toLowerCase().includes(term)) termScore += 40;
      if (description.includes(term)) termScore += 25;
      if (tags.some((tag) => tag.includes(term))) termScore += 20;

      const headingHits = entry.sections.filter((s) => normalise(s.heading).includes(term));
      termScore += headingHits.length * 30;

      const bodyHits = countOccurrences(entry.text, term);
      termScore += Math.min(bodyHits, 10) * 3;

      if (termScore === 0) {
        matchedAll = false;
        break;
      }
      score += termScore;
    }

    if (!matchedAll) continue;

    hits.push({
      slug: doc.slug,
      title: doc.title,
      href: doc.href,
      section: doc.section,
      description: doc.description,
      score,
      matches: bestMatches(entry.sections, terms, doc.href),
    });
  }

  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

/** Up to three deep-linkable excerpts, preferring distinct headings. */
function bestMatches(
  sections: DocSearchSection[],
  terms: string[],
  docHref: string,
): DocSearchHit["matches"] {
  const out: DocSearchHit["matches"] = [];
  for (const section of sections) {
    for (const term of terms) {
      const snippet = buildSnippet(section.text, term);
      if (!snippet) continue;
      out.push({
        heading: section.heading,
        href: section.id ? `${docHref}#${section.id}` : docHref,
        snippet,
      });
      break;
    }
    if (out.length >= 3) break;
  }
  return out;
}
