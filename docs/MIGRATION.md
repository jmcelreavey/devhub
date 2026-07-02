# Migration

Use this guide when moving from an older DevHub setup to the current structure.

## Before You Start

1. Commit or back up local changes.
2. Make sure your notes are saved.
3. Confirm you can restore from Git or another backup.

## Recommended Migration Flow

```bash
git pull
npm install
bash scripts/install.sh
npm run verify
```

Then open:

```text
http://localhost:1337/setup
```

Review paths, integrations, and network settings.

## What May Change

Depending on your previous version, migration may affect:

- Dashboard dependencies.
- MCP configuration files.
- Skill sync destinations.
- Persona sync behavior.
- Notes directory structure.
- Git hooks.
- Optional integration settings.

## Upgrading from Z_AI_* (June 2026)

Notes in-editor AI, Repo Learning generation, morning-briefing enrichment, and the **Tune briefing** chat now read **`AI_API_KEY`**, **`AI_BASE_URL`**, and **`AI_MODEL`** in `dashboard/.env.local`. The old `Z_AI_*` names were removed.

| Old name         | New name      |
| ---------------- | ------------- |
| `Z_AI_API_KEY`   | `AI_API_KEY`  |
| `Z_AI_BASE_URL`  | `AI_BASE_URL` |
| `Z_AI_MODEL`     | `AI_MODEL`    |

If you still have `Z_AI_*` in `.env.local` or a 1Password `devhub` item, rename the fields and restart the dev server. Without `AI_API_KEY`, notes AI, repo-learn generation, and briefing chat return HTTP 503; the briefing page itself still loads with deterministic sections.

When unset, `AI_BASE_URL` and `AI_MODEL` still default to z.ai (`https://api.z.ai/api/coding/paas/v4`, `glm-5-turbo`). See [Environment Variables](reference/environment-variables.md#notes-repo-learning-and-briefing-ai-optional).

## Notes Migration

DevHub expects notes to live in a structured notes directory with areas for daily notes, learnings, sessions, and diagrams.

If you have older notes, keep a backup before moving or converting them.

## Troubleshooting

| Problem                  | Fix                                   |
| ------------------------ | ------------------------------------- |
| Dashboard does not start | Run `npm run doctor`                  |
| MCP tools are missing    | Run MCP sync from the dashboard       |
| Skills are missing       | Run skill sync from the dashboard     |
| Persona is stale         | Run persona sync from the dashboard   |
| Verification fails       | Fix the reported issue before pushing |

## Safe Migration Rule

When in doubt, preserve old files first. DevHub is file-based, so backups are simple and valuable.
