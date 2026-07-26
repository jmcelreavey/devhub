# DevHub — scope and constraints

What DevHub is, what it deliberately isn't, and how to check it still works.

**Forward-looking work lives in [`ROADMAP.md`](./ROADMAP.md).** Completed work lives in
the git log — commit messages carry the reasoning, so this file no longer duplicates
them as a changelog.

---

## Status

Feature-complete for daily personal use. Local-only, Next.js 16 + React 19 +
BlockNote, filesystem JSON storage, with optional Google Calendar and Jira Cloud
integrations and a plugin overlay system (see `TEMPLATE_AND_PLUGIN_PLAN.md`).

## Constraints

- **Local-only** — `localhost:1337`, single user, one machine. No network deployment.
- **Tight scope** — ship what measurably reduces friction; defer ambition.
- **Degrade, don't break** — every external tool and integration is optional except
  `git` and `node`. A missing one turns a feature off; it doesn't break the app.

## Out of scope (deliberately)

- Auth, multi-user, network deployment — follows from local-only.
- Recurring tasks, task tags, task projects.
- Note tags and graph view. (Backlinks are on the roadmap; the graph view isn't.)
- Markdown export/import for the JSON note store.
- React Query migration — SWR is sufficient.
- Replacing BlockNote, the design-token system, or the hand-rolled component approach.
- A full Rust rewrite — see the appendix in `ROADMAP.md` for the costing.

These come back only when daily use surfaces a real need.

---

## Verification

Programmatic: `npm run typecheck`, `npm test`, `npx playwright test`, `npm run build`.

Manual smoke tests, one line each:

| Area | How to verify |
|---|---|
| Concurrency | Two tabs, rapidly toggle the same task. Both toggles land in `tasks/<today>.json`. |
| Hardcoded paths | `unset HOME && npm run dev` — health check fails fast with a clear message. |
| Corrupt files | `echo garbage > tasks/<today>.json && curl localhost:1337/api/tasks` — returns `[]` and leaves a `.corrupt-*.json`. |
| Toasts | Disconnect the network, save a task. Red toast with a Retry action. |
| Focus | Tab every page keyboard-only. Ring always visible, modals trap focus, Esc closes. |
| Empty states | Open Calendar with no Google creds — a config nag, not a blank panel. |
| Mobile sheet | Mobile viewport, open the notes panel — bottom sheet, not a 320px side panel. |
| Undo | Delete a task → toast with Undo → click within 5s → task returns. |
| Validation | `POST /api/tasks` with `{ text: "" }` → 400 with a Zod error message. |
| Command palette | `Cmd+K`, type "cal" → "Go to Calendar". Type a Jira prefix → matching tickets. |
| Offline | Load a page, stop the server, reload — cached page or the offline shell, not a browser error. |
| Setup | `/setup` → Tools step lists installed tools with versions and what each unlocks. |
| Run history | `/status` → Run history lists recent runs; failed ones offer a retry. |
