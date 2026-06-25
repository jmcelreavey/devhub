# API Routes

DevHub API routes are local endpoints used by the dashboard UI. They are not intended to be a public hosted API.

## Route Groups

| Group     | Purpose                                              |
| --------- | ---------------------------------------------------- |
| Actions   | Launch native OpenChamber/OpenCode apps when installed |
| Agents    | View shared and local agent configuration            |
| Infra plugin (`/api/bi/*`) | Optional plugin-backed ops: AWS profile, EKS, RDS, Mongo, CAPI, IAM |
| Calendar  | Google Calendar auth and event reads                 |
| Datadog   | Alert links and summaries                            |
| GitHub    | Pull request/review queues, recently reviewed PRs, and repository data |
| Jira      | Ticket data and redirects                            |
| Jobs      | Scheduled job management                             |
| Learnings | Browse reusable learning notes                       |
| MCP       | View MCP server configuration                        |
| Notes     | Notes CRUD, tree access, PR review notes under `pr-reviews/...`, note image assets (`GET /api/notes-assets/...`), optional in-editor AI (`GET /api/notes/ai/status`, `POST /api/notes/ai/chat`) |
| Docs      | Repo `docs/` markdown CRUD (`/api/docs/...`), file tree (`GET /api/docs/tree`), same ordering API as notes (`PATCH /api/note-order?vault=docs`) |
| Share     | Publish notes/docs as secret GitHub Gists (`GET`/`POST`/`DELETE` `/api/share`; `DELETE ?all=1` clears all) |
| Collections | Master checklist CRUD under repo `collections/` (legacy route name); `GET …/linked-label-drift?itemId=` and `POST …/sync-linked-labels` propagate master item labels into linked note blocks |
| OpenCode  | Read/update shared `opencode.json`; secret env hints |
| Persona   | View shared and local persona configuration          |
| Repos     | Repository discovery, actions, and Repo Learning artifacts |
| Scripts   | Run allowlisted maintenance scripts                  |
| Search    | Full-text search (`?q=` required; default notes, `?vault=docs` for docs) |
| Setup     | Read and save setup configuration                    |
| Status    | Health checks for Git, services, MCP, and LAN access |
| Sync preview | Preview repo → local sync without applying        |
| Tasks     | Task CRUD, open-task reorder (`PATCH` with `{ ids }`), rollover, timers, and history |
| Tree      | Notes file tree listing                              |

## Common Behavior

- Routes return JSON unless they stream logs or redirect.
- Mutating routes are intended for same-origin dashboard use.
- Long-running actions expose progress through server-sent events.
- Optional integrations should fail clearly when unconfigured.

## Notable User-Facing Routes

| Route | Used By | Notes |
| ----- | ------- | ----- |
| `GET /api/github/prs` | Today GitHub PR panel, `/prs` | Requires an authenticated local `gh` session. Returns authored PRs, review-requested PRs, and recently reviewed PRs; archived repositories are filtered from active queues. |
| `GET /api/notes/pr-reviews/<slug>` | PR **Notes** links | The GitHub PR **Review** action polls this route after starting OpenCode. A `404` just means the review note has not been written yet. |

## Contributor Guidance

When adding routes:

- Keep route responsibilities narrow.
- Validate input at the boundary.
- Return useful errors for the UI.
- Avoid exposing arbitrary shell or filesystem access.
- Keep public documentation at the group level unless a route is user-facing.
