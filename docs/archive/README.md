---
title: Archive
description: Plans for work that has since shipped, plus point-in-time audits.
order: 0
icon: Archive
tags: [archive]
---

# Archive

Plans for work that has since shipped, and point-in-time audits.

They are kept because the _reasoning_ is often still useful — why a thing was
built the way it was — but they are **not** current documentation and should not
be read as a description of how the system works today. For that, see the code
and `docs/architecture/`.

| Document                                                          | Shipped as                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------------- |
| [`agents-workspace-aionui-plan.md`](agents-workspace-aionui-plan.md) | Replaced by the Paseo integration (`/agents`)               |
| [`capability-radar-plan.md`](capability-radar-plan.md)            | `dashboard/lib/capability/`, `/radar`                       |
| [`devhub-mcp-split-plan.md`](devhub-mcp-split-plan.md)            | `mcp-servers/devhub-server/`                                |
| [`onboarding-and-tauri-roadmap.md`](onboarding-and-tauri-roadmap.md) | Setup wizard and `desktop/` (hosted Google OAuth deferred)  |
| [`repo-ownership-plan.md`](repo-ownership-plan.md)                | `/own`, `dashboard/lib/ownership/`                          |
| [`self-appraisal-mcp-plan.md`](self-appraisal-mcp-plan.md)        | `dashboard/app/appraisal/`, `shared/appraisal/`             |
| [`tauri-desktop-plan.md`](tauri-desktop-plan.md)                  | `desktop/` (the detailed plan behind the roadmap above)     |
| [`db-client-parity-audit.md`](db-client-parity-audit.md)          | Point-in-time audit, August 2026                            |
| [`git-client-parity-audit.md`](git-client-parity-audit.md)        | Point-in-time audit, August 2026                            |
| [`mobile-audit-2026-06-15.md`](mobile-audit-2026-06-15.md)        | Point-in-time audit, June 2026                              |

Plans for work that has **not** shipped yet live in [`docs/plans/`](../plans/notes-and-learnings.md).

An agent reading `docs/` shouldn't have to guess which files describe intentions
and which describe reality. If a plan here is still partly unbuilt, move the
unbuilt part into an issue rather than leaving the whole document ambiguous.
