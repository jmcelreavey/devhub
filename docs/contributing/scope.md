---
title: Scope and constraints
description: What DevHub is, what it deliberately isn't, and how to check a change hasn't broken the basics.
order: 1
icon: Compass
tags: [contributing, scope]
related:
  - architecture/overview
  - architecture/plugins
---

# Scope and constraints

Read this before proposing a feature. It lists what DevHub is, what it deliberately isn't,
and how to check a change hasn't broken the basics.

**Open work lives in [`ROADMAP.md`](../../ROADMAP.md).** Completed work lives in the git
log — commit messages carry the reasoning, so this page doesn't duplicate them as a
changelog.

---

## Status

Feature-complete for daily personal use. Local-first: Next.js 16 + React 19 + BlockNote,
filesystem storage, optional integrations (Google Calendar, Jira, GitHub, Datadog, Figma),
a packaged desktop app, and a plugin overlay system (see
[Plugin system](../architecture/plugins.md)).

## Constraints

- **Local-first** — one user on a trusted machine, with optional trusted-LAN access.
  The default dashboard port is `1337`; hosted deployments are outside the scope.
- **Tight scope** — ship what measurably reduces friction; defer ambition.
- **Degrade, don't break** — integrations are optional. A missing tool turns its
  feature off; notes and tasks still work. Checkout installs need Node, and code
  workflows need Git. The packaged app includes its own Node runtime.

## Out of scope (deliberately)

- Multi-user accounts and hosted deployment.
- Recurring task rules (scheduled jobs are a separate feature).
- A note graph view. (Backlinks and note metadata are proposed in
  [Notes and learnings](../plans/notes-and-learnings.md); the graph view isn't.)

- React Query migration — SWR is sufficient.
- Replacing BlockNote, the design-token system, or the hand-rolled component approach.
- A full Rust rewrite — the costing is in the appendix of the
  [onboarding and Tauri roadmap](../archive/onboarding-and-tauri-roadmap.md).

These come back only when daily use surfaces a real need.

---

## Verification

Run `npm run verify` from the repo root for MCP types, dashboard lint, types and tests,
vendored-skill checks, the production build and dynamic-route checks. Run browser
journeys with `npm run test:e2e --prefix dashboard`.

Use a disposable data directory for browser checks. If the desktop app is running,
use a free port, `DEVHUB_SCHEDULER=0` and a separate `DEVHUB_DIST_DIR` — see
[Installation](../getting-started/installation.md#run-the-dashboard). Check keyboard
navigation, narrow layouts and the loading, empty and error states of the changed
surface.
