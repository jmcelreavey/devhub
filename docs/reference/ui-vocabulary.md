---
title: UI vocabulary
description: The components, hooks and CSS classes that already exist, so a change reuses them instead of reinventing them.
order: 60
icon: Blocks
tags: [reference, ui]
related:
  - contributing/motion
  - architecture/dashboard
---

# UI Vocabulary

On-demand reference. Read it **before** writing new UI in `dashboard/`, then
grep for the one you picked.

It exists because "reuse before you add" is unusable as advice on its own: an
agent that does not know `tone-panel--warning-banner` exists will write a new
warning style, and one that does not know `FetchError` exists will hand-roll an
error row. Both produce a working change that quietly makes the UI less
consistent, and both cost far more to discover than to look up.

Not exhaustive — it covers the generic primitives. Feature-scoped classes
(`repo-*`, `briefing-*`, `today-*`, `terminal-*`, `entity-*`) belong to their
own areas; grep those directly.

## Before you add anything

1. Is there a component in `components/ui/` for it?
2. Is there a CSS primitive below for it?
3. Is there a hook in `lib/hooks/` for it?
4. Only then write something new — and put it beside its neighbours.

## Components (`dashboard/components/ui/`)

| Need | Use |
| --- | --- |
| Loading placeholder shaped like the content | `SkeletonRows`, `PageSkeleton`, `LoadingLine` |
| A fetch failed, offer retry | `FetchError` (`bare` when already inside a `.card`) |
| Nothing to show | `EmptyState`, `EmptyStateRow` |
| Route-level error / loading boundary | `RouteError`, `RouteLoading` |
| List that handles its own loading/error/empty | `AsyncListSection`, `ListFetchStates`, `ConditionalList` |
| Section wrapper with a header | `CardSection` |
| Search box | `SearchInput`, `InlineSearch`, `SearchResultList` |
| Copy to clipboard | `CopyButton`, `CopyLocationButton` |
| Tooltip on hover | `HoverTip` |
| Status / severity indicator | `StatusDot`, `SeverityDot`, `SeverityPill` |
| Segmented control | `ToggleGroup` |
| Reorderable list | `SortableList` + `SortableDragProvider` |
| Render markdown inline | `SimpleMarkdown` |
| Field-level validation message | `FieldError` |
| Icon chooser | `IconPicker`, `IconGridPopover` |

## CSS primitives (`dashboard/app/globals.css`)

Generic only. Everything else is feature-scoped.

- **Buttons** — `btn` plus `btn-primary`, `btn-ghost`, `btn-danger-ghost`
- **Badges** — `badge` plus `badge-muted`, `badge-success`, `badge-warning`,
  `badge-danger`, `badge-accent`
- **Cards** — `card`, `card-header`, `card-body`
- **Panels with a tone** — `tone-panel` plus `tone-panel--muted`,
  `tone-panel--accent`, `tone-panel--warning`, `tone-panel--danger`,
  `tone-panel--warning-banner` (the full-width "something is degraded" strip)
- **Dots** — `tone-dot` plus `tone-dot--sm`/`--md` and a tone modifier
- **Inputs** — `input`
- **Loading** — `skeleton`

Colours come from tokens (`var(--text)`, `--text-subtle`, `--text-muted`,
`--accent`, `--warning`, `--danger`, `--success`, `--border`, `--bg-elevated`,
`--bg-surface`). Never hard-code a hex. Run `npm run check:contrast` after
touching colour.

## Hooks (`dashboard/lib/hooks/`)

| Need | Use |
| --- | --- |
| Fetch + poll an API | `useLive` — pauses while `PanelVisibilityContext` is false (hidden overlays/docks). Inactive workspace tabs unmount, so their pollers die with them. |
| Is this panel visible? | `usePanelVisible` |
| Persist a small UI choice | `useStoredState`, `useStoredChoice`, `useStoredFraction` |
| Toast | `useToast` |
| Viewport / mobile | `useIsMobile`, `useMediaQuery`, `useGridSize`, `useMobileShelf` |
| Debounced search input | `useDebouncedSearch` |
| Long list performance | `useVirtualRows` |
| Avoid SSR/client mismatch | `useClientMounted` |
| GitHub PR search | `useGithubPrSearch` |

## Server-side helpers worth knowing

- **Any external command** — `execExternal` (`lib/exec-external.ts`). Mandatory
  timeout, feeds `/api/status/exec`. Never call `execFile`/`spawn` directly.
- **`gh`** — `execGh`, `execGhJsonLines`, `execGhJsonArray` (`lib/gh-exec.ts`);
  map failures with `mapGithubCliError`.
- **`git` in a repo** — `runGitRepoAsync` / `runGitRepo` (`lib/git/repo-local.ts`).
- **GitHub PR search** — `searchIssues` + `rowFromSearchItem` (`lib/github/prs.ts`).
- **Note exists?** — `useVaultNoteExists`; never GET a note to test existence.
- **API route wrapper** — `withErrorHandler` + `parseBody` (`lib/api-utils.ts`).

## Rules that are not negotiable

- **Shimmer for content arriving, spin only for an action the user just
  triggered.** See `docs/contributing/motion.md`.
- **Every surface needs empty, loading and error states**, including the ones
  that only occur when an integration is down.
- **Check `git ls-files -- <path>` before editing anything in `dashboard/`.**
  No output means the file is plugin-owned and will be overwritten on restart —
  edit the plugin repo instead.
