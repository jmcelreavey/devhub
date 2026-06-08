# DevHub — Roadmap & Recent Changes

This is the rolling plan for the DevHub dashboard. Older build-out phases are folded into the project's git history; the current state is reflected in this file.

---

## Status

DevHub is feature-complete for daily personal use. The dashboard is local-only, Next.js 16 + React 19 + BlockNote + filesystem JSON storage, with optional Google Calendar and Jira Cloud integrations.

The most recent pass focused on **correctness, daily UX friction, and developer-clone friction** — not new surface area. See "Recent changes (review pass)" below.

## Constraints

- **Local-only forever** — `localhost:1337`, no auth, no network deployment.
- **Single user** — one machine, one developer (this is your machine).
- **Tight scope** — only ship features that meaningfully reduce friction; defer ambition.

---

## Recent changes (review pass)

### Correctness & data safety
- **Atomic file writes** — `lib/atomic-write.ts` with write-temp-then-rename, plus a per-key in-process mutex for read-modify-write cycles. Used by `tasks-storage.ts`, `storage.ts`, and `/api/capture`. Concurrent task toggles can no longer lose data.
- **Hardcoded `/home/john` fallbacks removed** — replaced 8 sites with `getHome()` (`lib/notes-dir.ts`) that throws if `HOME` is unset.
- **`withErrorHandler`** wraps every API route so a thrown error becomes a typed JSON 500, not a crash.
- **Jira `any` killed** — `JiraIssue` interface in `lib/jira-client.ts`.
- **Corrupt JSON files surface, not silenced** — `safeReadJSON` renames bad files to `.corrupt-<ts>.json` and returns the fallback, so the user has a recoverable copy instead of silent data loss.

### UX polish
- **Toast system** — `ToastProvider` + `useToast()` hook. Replaces silent `.catch` swallowing across CaptureBar, TaskList, NotesOverlay, TodayPage, repos page. Includes retry actions where appropriate.
- **ConfirmDialog** — design-token-styled modal replaces `window.confirm` (used on "Clear today's note").
- **Error boundaries** — `app/error.tsx` plus per-route `error.tsx` for `/calendar` and `/tickets` with retry buttons and config hints.
- **Four-state widgets** — Calendar / Jira on Today plus their full-page views explicitly distinguish loading / error / unconfigured / empty.
- **Accessibility** — global `:focus-visible` ring, `role="dialog"`, `aria-modal`, `aria-labelledby`, focus restoration on close, hidden labels for placeholder-only inputs across CaptureBar, TaskList, MobileNav, NotesOverlay, ShortcutsModal, ConfirmDialog, CommandPalette.
- **SWR auto-refresh** — Calendar, Jira, repos revalidate on focus and every 60s (`lib/use-fetch.ts`). Manual refresh buttons remain.
- **Undo on task delete** — 5s window via toast action; the DELETE only fires after the timer.
- **Mobile NotesOverlay** — renders as a bottom sheet on `< 768px` instead of a 320px-wide side panel.

### Setup & verifiability
- **`dashboard/.env.example`** — checked-in template covering required + optional env vars.
- **Startup health check** — `scripts/health-check.ts` runs as `predev` / `prestart`. Verifies `HOME`, `NOTES_DIR`, `REPO_ROOT`, port availability, and partial-config patterns for Jira / Google. Creates missing notes dirs.
- **Vitest** — 32 tests pinning down storage round-trips, path traversal, atomic-write concurrency, corrupt-file rename, task storage CRUD + concurrent adds, Zod schema edges. Run with `npm test`.
- **Zod input validation** — `lib/schemas.ts` schemas applied to `/api/tasks`, `/api/capture`, `/api/notes/[...path]`. Bad bodies return 400 with a descriptive message.
- **README** — local-only banner at the top of the Dashboard section. Capabilities list updated with the new shortcuts and behaviours.

### Tight-scope additions
- **Global command palette (`Cmd+K`)** — `CommandPalette.tsx` searches across nav actions, captured tasks (toggle done from the palette), Jira tickets (open in browser), and notes (jump to viewer). Notes-only overlay moved to `Cmd+Shift+O`.
- **Task due dates** — optional `due` field on tasks, inline date picker, overdue tasks float to the top with a red dot.
- **Today digest** — single-row summary at the top of the Today page: tasks done, captures today, tickets in progress.

---

## Out of scope (deliberately deferred)

- Auth / multi-user / network deployment (per local-only constraint).
- Light theme / system theme switcher.
- Recurring tasks, drag-reorder, task tags, task projects.
- Note tags, backlinks, graph view.
- PWA / offline / service worker.
- Markdown export/import for the JSON note store.
- Activity feed beyond the Today digest.
- React Query migration (SWR is sufficient).
- Replacing BlockNote, the design-token system, or the hand-rolled component approach.

These come back as a v2 plan when daily use surfaces a real need.

---

## Verification

Each phase has a one-line manual smoke test:

| Area | How to verify |
|---|---|
| Concurrency | Open two tabs, rapidly toggle the same task. Both toggles must land in `tasks/<today>.json`. (Pre-fix this lost one.) |
| Hardcoded paths | `unset HOME && npm run dev` — health check fails fast with a clear message. |
| Corrupt files | `echo "garbage" > tasks/<today>.json && curl localhost:1337/api/tasks` — returns `[]` and creates a `tasks/<today>.corrupt-*.json`. |
| Toasts | Disconnect network, save a task. Red toast with Retry action appears. |
| Focus | Tab through every page keyboard-only. Ring always visible, modals trap focus, Esc closes them. |
| Empty states | Open Calendar with no Google creds — config nag with `.env.local` link, not a blank panel. |
| Mobile sheet | DevTools mobile viewport, open the notes panel — bottom sheet not a 320px side panel. |
| Undo | Delete a task → toast with Undo, click within 5s, task is back. |
| Health check | Fresh clone: `cp .env.example .env.local`, `npm install`, `npm run dev` → "DevHub ready on http://localhost:PORT". |
| Validation | `POST /api/tasks` with `{ text: "" }` → 400 with Zod error message. |
| Command palette | `Cmd+K` opens, type "cal" → "Go to Calendar" appears, Enter navigates. Type "FOO-" → matching tickets appear. |
| Due dates | Add a task with a date in the past — sorts to the top with a red dot. |
| Digest | Add 3 tasks, complete 2, capture a learning → digest reads "2/3 tasks done · 1 capture". |

Programmatic checks: `npm run typecheck`, `npm test`, `npm run build`.

---

## Historical phases

The original build-out (Phases 0–9, branch `feat/dashboard-and-audit`) is in the git log. Highlights:

- **Phase 0** — security fixes (path traversal, sync_skills walrus bug, install scripts).
- **Phase 1** — doc cleanup, token-budget rebalancing.
- **Phases 2–3** — Express notes server replaced by Next.js 15 dashboard.
- **Phase 5** — BlockNote JSON storage migration.
- **Phase 6** — MCP server JSON support.
- **Phase 7** — global notes overlay.
- **Phase 8** — OpenChamber integration.
- **Phase 9** — UI polish and final validation.
- **Phase 10** — open `feat/dashboard-and-audit` PR to `main`.

If you need the full historical context, `git log --oneline` and the commit messages on `feat/dashboard-and-audit` carry the story.
