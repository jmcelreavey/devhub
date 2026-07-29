---
title: Quality backlog
description: The standing DRY/DX themes tracked across the codebase.
order: 5
icon: ListTodo
tags: [reference]
---

# Backlog

This page summarizes the main quality themes from the internal DRY/DX backlog.

It is intentionally condensed so it stays useful as the codebase changes.

## Main Themes

| Theme                           | Why It Matters                                                     |
| ------------------------------- | ------------------------------------------------------------------ |
| Shared UI primitives            | Reduces duplicated modal, empty state, loading, and error patterns |
| Fewer inline styles             | Makes theming and visual consistency easier                        |
| Consistent page conventions     | Makes new pages easier to build and review                         |
| Better loading and error states | Improves trust in optional integrations                            |
| Smaller large files             | Makes maintenance and review easier                                |
| Stronger type boundaries        | Reduces runtime surprises from external data                       |
| Accessibility polish            | Keeps the dashboard usable across inputs and devices               |

## Good First Improvements

- Extract repeated empty and error states.
- Standardize page headers.
- Replace hardcoded colors with theme variables.
- Add missing error boundaries where they improve recovery.
- Split large files only when there is a clear seam.

## Contribution Guidance

Keep cleanup incremental. Prefer small, safe improvements over broad rewrites.

If a cleanup touches user-facing behavior, verify the affected page manually.

## Docs site follow-ups

The docs vault now renders as a read-first site (article view, table of contents,
backlinks, full-text search, Mermaid diagrams). Several pieces of that were built
generically and are worth reusing elsewhere:

| Piece | Lives in | Reusable for |
| ----- | -------- | ------------ |
| Markdown → AST renderer | `lib/docs/markdown-ast.ts`, `components/docs/DocContent.tsx` | Any Markdown surface: shared/published notes, skill and agent previews, README rendering on the Repos page |
| Heading TOC + scroll spy | `components/docs/DocToc.tsx` | Long note pages, the appraisal and briefing views |
| Backlink graph | `lib/docs/doc-index.ts` | Notes — a wiki-link graph across `notes/` is the same shape of problem |
| Section-scoped search with snippets | `lib/docs/doc-search.ts`, `/api/docs/search` | The command palette, which currently ranks by filename rather than content |
| Themed Mermaid | `lib/docs/mermaid-theme.ts`, `components/docs/DocMermaid.tsx` | Already shared with the editor's `MermaidBlock`, which still uses stock theming |

Notes and Learnings are BlockNote JSON rather than Markdown, so the renderer does
not drop straight in — the reusable half is the *chrome* (contents, backlinks,
search), not the parser.

> [!NOTE]
> Nothing here is personal-data-bound, so the whole docs site is a candidate for
> back-porting to the public core. See [Fork Workflow](../contributing/fork-workflow.md).

### Guardrails worth keeping green

- `npm run test` includes `lib/docs/docs-tree.test.ts`, which fails the build on a
  broken relative link, a dead heading anchor, a doc missing frontmatter, or an
  icon the renderer cannot resolve.
- `npm run docs:diagrams` renders every Mermaid block headlessly under both light
  and dark theme variables. Diagram syntax errors are otherwise invisible — a bad
  diagram renders as an empty box with nothing in the console.
- `npm run docs:frontmatter -- --check` verifies every doc still has curated
  metadata after files move.
