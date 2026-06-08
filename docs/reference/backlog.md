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
