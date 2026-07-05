# Scheduled Jobs

Scheduled jobs let DevHub run selected maintenance actions on a cron-like schedule while the dashboard is running.

## What Jobs Are For

- Periodic update and sync.
- Validation checks.
- Other safe allowlisted actions.

## Important Limits

Scheduled jobs only run while the dashboard process is alive.

They are not a system cron replacement. If DevHub is closed, jobs do not run.

## Good Job Candidates

| Job                   | Why                                     |
| --------------------- | --------------------------------------- |
| Update and sync       | Keeps local tools fresh                 |
| Validate              | Finds breakage early                    |
| Push unpushed commits | Useful only if your workflow expects it |

## Safety Tips

- Avoid scheduling actions that need human judgment.
- Keep jobs low-risk and reversible.
- Review logs when a job fails.
- Do not schedule workflows that may expose secrets.

## Managing Jobs

Use the Actions page to view and manage scheduled jobs. Prefer the UI unless you are debugging.

## API (dashboard running)

While the dashboard process is alive, jobs are exposed as local JSON routes (same-origin on mutating calls):

| Route | Method | Purpose |
| ----- | ------ | ------- |
| `/api/jobs` | `GET` | List jobs plus the allowlisted `scripts` catalog for the picker |
| `/api/jobs` | `POST` | Create a job — body: `{ name, script, cron, enabled? }` |
| `/api/jobs/<id>` | `GET` | Read one job |
| `/api/jobs/<id>` | `PATCH` | Update `name`, `cron`, `enabled`, or `script` |
| `/api/jobs/<id>` | `DELETE` | Remove the job |
| `/api/jobs/<id>` | `POST` | Trigger immediately — returns `202` with run info |

`script` must be an allowlisted action ID (same catalog as `GET /api/scripts`). See [API Routes](../reference/api-routes.md) for script run polling (`/api/scripts/runs/<runId>`, `/api/scripts/stream/<runId>`).
