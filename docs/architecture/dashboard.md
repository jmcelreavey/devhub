# Dashboard Architecture

The dashboard is the main DevHub interface. It is a local Next.js app with pages for tasks, notes, integrations, skills, actions, status, and setup.

## What The Dashboard Provides

| Area         | Purpose                                                                      |
| ------------ | ---------------------------------------------------------------------------- |
| Today        | Daily workspace with tasks, notes, calendar, tickets, PRs, and standup tools |
| Notes        | BlockNote editing, file tree, folder-scoped master checklists, optional z.ai in-editor AI |
| Docs         | In-app editing of repo `docs/` markdown (BlockNote with markdown round-trip), file tree, content sync |
| Tasks        | Daily task management, drag reorder for open items, and history              |
| Skills       | Shared skill viewing, creation, sync, and collection                         |
| Actions      | Safe script runner for maintenance tasks                                     |
| Status       | Health checks for repo, services, MCP, and network access                    |
| Setup        | Environment and integration configuration                                    |
| Integrations | Calendar, Jira, Datadog, GitHub, and internal ops views                      |

## Page Pattern

Most pages follow a simple pattern:

```text
Page route
  -> loads a screen
  -> calls local API routes
  -> renders data with loading, empty, error, and success states
```

The browser talks to the dashboard API. The API reads local files, shell tools, or third-party services depending on the feature.

## API Pattern

Dashboard API routes are local endpoints used by the UI. They are not intended as a public external API.

Common responsibilities include:

- Reading and writing notes or tasks.
- Running safe allowlisted actions.
- Checking setup status.
- Fetching integration data.
- Streaming action logs back to the UI.

## State Management

DevHub avoids a large global state system.

| State Type                 | Typical Location                        |
| -------------------------- | --------------------------------------- |
| Server data                | Local API routes and client fetch hooks |
| UI preferences             | Browser storage                         |
| Persistent user data       | Files on disk                           |
| Long-running action output | Server-sent event streams               |

This keeps the app understandable and makes most features independent.

## Tasks

Daily tasks live in repo-root `tasks/YYYY-MM-DD.json` (one file per calendar day). The **Today** and **Tasks** views read and mutate them through `/api/tasks`.

| Behavior | Detail |
| -------- | ------ |
| Rollover   | Open tasks from yesterday copy into today on first load; yesterday entries get `movedAt` / `movedToDate` |
| Reorder    | Drag open tasks in the list (or use arrow keys on the drag handle). Only **open** tasks reorder; done, abandoned, and moved tasks keep their relative slots. Order is array position in the day's JSON file. |
| API        | `PATCH /api/tasks` with `{ ids: string[], date?: string }` — must include every open task id exactly once |

Completed and abandoned tasks stay in the file for history and standup; they are not included in reorder requests.

## Safety Boundaries

The dashboard is powerful because it can run local scripts and write files. To keep that manageable:

- Actions are allowlisted.
- Paths are validated before file access.
- Secrets stay in local environment files or secret managers.
- Setup makes optional integrations explicit.

## Contributor Guidance

When adding dashboard features:

- Prefer a small page plus a small API route.
- Keep optional integrations graceful when unconfigured.
- Show useful loading, empty, and error states.
- Avoid making local-only features look like public APIs.
