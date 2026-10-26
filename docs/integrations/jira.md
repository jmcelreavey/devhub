---
title: Jira
description: Bring assigned tickets into DevHub and improve standup generation.
order: 2
icon: SquareKanban
tags: [integrations]
related:
  - guides/standup
  - guides/plan-loop
  - architecture/mcp-server
---

# Jira

The Jira integration brings assigned tickets into DevHub and improves standup generation.

## What It Enables

- Ticket list and status filters.
- Today widget for assigned work.
- Links from Jira keys in tasks.
- Parent ticket keys on Jira and task rows; click a parent key to copy it. Right-click **Open in Jira** uses the ticket's browse URL through the desktop opener (`window.open` is a silent no-op in the webview).
- Standup content based on recent ticket activity.

## Setup

Configure Jira from `/setup`.

| Setting        | Purpose                                       |
| -------------- | --------------------------------------------- |
| Jira domain    | Your Atlassian Cloud domain                   |
| Jira email     | Account email used for API access             |
| Jira API token | Token created from Atlassian account settings |

## Jira Keys In Tasks

When a task contains a key such as `DAD-1234`, DevHub can treat it as a Jira reference.

This helps with linking and standup generation.

## Create Tickets From Tasks

Right-click an open task and choose **Generate Jira ticket…**. The
`devhub-draft-jira-ticket` skill uses the task note, linked notes, nearby references
and available Jira descriptions to draft a title and description in your writing
voice. It uses the same configured AI provider as the notes preview.

Review and edit both fields in the creation form. Generation does not create a
ticket or change the task; **Create ticket** submits the reviewed content to Jira.
Generated Jira text omits DevHub references and local dashboard links. If a
reference could not be read, the form tells you what is missing.

The daily task list also offers **Add to Jira manually…**. The creation form:

- Seeds the summary from task text (strips an existing linked key if present).
- Lets you pick a parent: the linked ticket's parent when it has one, another key, or none.
- Resolves the project from the selected key prefix, falling back to `PTF`.
- Shows board, active sprint, assignee, and inherited **Team** from `GET /api/jira/meta` (pass `reference=<parentKey>` to inherit Team from the parent).
- Optionally adds the issue to the active sprint.
- Creates a **Task** or **Sub-task** (when a parent is set) via `POST /api/jira/issue`, assigns to you by default, and rewrites the task text with the new key.

| Route                                                     | Purpose                                                                                                                            |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/jira/meta?project=<KEY>&reference=<parentKey>?` | Board, sprint, Team field ids/values, and assignee for the modal                                                                   |
| `POST /api/jira/draft` | Body: `{ taskId, date }` — returns `{ summary, description, warnings }` for review; no Jira or task writes |
| `POST /api/jira/issue`                                    | Body: `{ projectKey, summary, description?, parentKey?, issuetypeName?, assignToMe?, sprintId? }` — returns `{ key, url }` (`201`) |

## Create Tickets From MCP

Agents can use `jira_ticket_create` with `projectKey`, `summary`, and a Markdown
`description`. Optional fields are `parentKey`, `assignToMe` (defaults to true),
and `sprintId`. The dashboard chooses the issue type from the parent and inherits
its Team, just as the creation form does.

Creation applies immediately with `confirm: true`. Without it, the tool previews
without contacting Jira. There is no proposal queue or human approval step.
The tool uses the authenticated dashboard client and does not attach the new key
to a DevHub task.

Each call creates another issue. If a request times out, check Jira before retrying.

## Workflow Transitions

When you complete or abandon a task that includes a Jira key, DevHub can prompt you to move the ticket to a new workflow state.

| Route                                    | Purpose                                           |
| ---------------------------------------- | ------------------------------------------------- |
| `GET /api/jira/ticket/<key>/transitions` | Lists available transitions for the ticket        |
| `POST /api/jira/ticket/<key>/transition` | Body: `{ transitionId }` (or `{ toStatusId }` for Undo). Applies immediately and answers `{ ok, key, from, to, undo, result }`. Same-origin. |

The prompt is optional — you can dismiss it without changing Jira. Picking a status from a chip, row menu or link moves the ticket at once and shows a toast with **Undo**. Your click is the approval and still lands in Recent actions. There is no separate approval-queue screen.

Agents use MCP `jira_ticket_transition`. Omit `transitionId` to list options. Pass `confirm: true` with a `transitionId` to apply it immediately through the same route — there is no proposal queue. Without `confirm`, the tool refuses rather than moving the ticket. Check Jira before retrying a timeout. See [MCP Server](../architecture/mcp-server.md#integration-writes).

When the new status name looks like Code Review / In Review / Ready for Review / Peer Review, DevHub also marks that ticket's linked **draft** PRs ready for review (same safety net as completing the task). See [Plan loop — Ready for review](../guides/plan-loop.md#ready-for-review).

## Ticket list and search

Assigned tickets appear on **Work → Jira** (`/work`) and the legacy **`/tickets`** route (palette-only; same data). Both read `GET /api/jira/tickets` and sort by `updatedAt` descending.

| Surface | Filters |
| ------- | ------- |
| `/tickets` | Status tabs: All, To Do, In Progress, In Review, Done — plus an `InlineSearch` row |
| Work → Jira | Same status grouping inside the Work shell; shares the Work search row |

Search matches key, summary, status, priority, type, project, and assignee. Whitespace-separated terms are AND-ed (`PROJ auth` narrows). The search hint shows `{filtered} of {total}` while typing.

## Usage Tips

- Keep task text clear even when it includes a ticket key.
- Use Jira for source-of-truth ticket status.
- Use DevHub tasks for personal daily execution.

## Troubleshooting

| Problem                         | Check                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| Tickets are missing             | Jira credentials and domain are correct                                               |
| Links go to the wrong Jira site | Public Jira domain setting matches your workspace                                     |
| API errors                      | The token has not expired or been revoked                                             |
| `503` on ticket routes          | Jira is not configured — complete `/setup` or expect empty badges on a fresh checkout |

Mutating Jira routes (`POST /api/jira/issue`, transitions) and per-ticket reads
return **503** with `code: "not_configured"` when credentials are absent. The
ticket list route (`GET /api/jira/tickets`) instead returns
`{ tickets: [], configured: false }` with HTTP 200.
