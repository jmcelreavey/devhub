# Skills

Skills are reusable instructions for AI agents. They capture repeatable workflows, checklists, and domain-specific guidance.

## Where Skills Live

Shared skills live in the DevHub repo under `skills/shared/` and can be synced into local AI tools.

Optional shared/team skills can live in an **ai-tools** checkout under `skills/`. DevHub merges them at sync time from a local clone and exposes them with a `bi-` catalog prefix unless they already have one. They appear on the Skills page with an **ai-tools** badge and are read-only in DevHub (edit them in ai-tools, then **Refresh** or run sync).

Each skill should have a clear name and a `SKILL.md` file that explains when and how to use it.

Configure `AI_TOOLS_ROOT` if your clone is not at `~/Developer/ai-tools`. Set `AI_TOOLS_SYNC=0` to sync DevHub skills only. Set `AI_TOOLS_REFRESH_ON_SYNC=0` if you want sync to skip upstream fetch (airplane mode). Set `AI_TOOLS_BRANCH` to override the default branch (normally resolved via `gh`). Requires `gh auth login` for upstream refresh.

Example:

```bash
AI_TOOLS_ROOT=~/Developer/ai-tools
AI_TOOLS_BRANCH=main
```

Constraints:

- DevHub never edits the ai-tools checkout; those rows are read-only in the UI.
- DevHub skills win on name collision. If `skills/shared/bi-foo` exists, it replaces ai-tools `foo` or `bi-foo`.
- Upstream refresh writes a cache under `~/.cache/devhub/ai-tools-upstream/` and leaves the working tree untouched.

Excluded skills (eye icon on the Skills page) are not synced or pruned; old copies remain in tool directories until you remove them manually.

## Good Skill Design

A good skill is:

- Narrow enough to trigger reliably.
- Practical enough to guide real work.
- Written as a workflow, not an essay.
- Free of secrets and machine-local paths.
- Easy to review in Git.

## Creating A Skill

You can create a skill from the dashboard or by adding a shared skill folder manually.

Recommended sections:

```markdown
# Skill Name

## When To Use

## How To Use

## Checks
```

Keep examples short and realistic.

## Syncing Skills

Run skill sync when:

- You pull new shared skills.
- You edit a shared skill.
- A tool does not show a skill you expect.
- You want the latest ai-tools skills (or use **Refresh** on the Skills page).

Use the source filter (**All / DevHub / ai-tools / Local**) and the eye control to exclude catalog skills from sync and prune.

### Sync preview before sync

Before syncing skills or agents, the dashboard can show what would change without applying it:

- **Agents → Skills / Agents tabs** — preview runs when you open sync controls (`GET /api/sync-preview?kind=skill` or `?kind=agent`).
- **Status → Skill sync** — when `GET /api/sync-health` reports `healthy: false`, embedded previews explain missing or drifted entries.

Preview response fields:

| Field | Meaning |
| ----- | ------- |
| `targets[].writes` | Files that would be created or updated (`reason`: `missing` or `changed`) |
| `targets[].prunes` | Local entries that would be removed when prune is enabled |
| `targets[].unchanged` | Count of entries already in sync |
| `excluded` | Slugs skipped via the eye icon or `exclude=` query param |

Preview is read-only. It does not replace `dry_run_scoped_sync` (that action previews **content** git paths only). See [Sync Engine](../architecture/sync-engine.md#preview-without-applying).

## MCP tab

Sidebar **Agents** → tab **MCP** manages the MCP catalog:

| Scope | Storage | Synced to tools |
| ----- | ------- | --------------- |
| Repo | `mcp/shared/<name>.json` | Yes — committed with DevHub |
| Personal | `~/.config/devhub/mcp-personal/<name>.json` | Yes — machine-local, never committed |

Use **New server** to create an entry, or **Import** (`GET /api/mcp/local`) to copy from an existing tool config. The eye icon excludes a server from forward sync and prune (same semantics as skills). **Sync MCP** on Actions runs the MCP sync action.

**Catalog vs runtime:** `/api/mcp*` edits JSON configs. `/api/status/mcp` (Status page) only inspects running processes for `mcp/shared/` entries. Plugin and personal servers sync to AI tools but do not appear on Status.

## Collecting Skills (add to catalog)

On the **Agents → Skills** tab, the catalog list includes **local-only** rows (skills that exist under `~/.codex/skills`, `~/.claude/skills`, etc. but not yet in `skills/shared/`).

- **Add to catalog** on a row copies that skill into `skills/shared/` and stages it with git.
- Use checkboxes and **Add selected to catalog** for bulk import.
- Rows with a migration badge (e.g. local newer, diverged) already exist in the catalog but differ from your local copy — import overwrites per the same rules as **Collect Skills** in Actions.

The same pattern applies on **Agents → Agents** for `agents/shared/`. See [Shared Agents](agents.md) for subagent format and the current specialist catalog.

### Smoke test (local)

With the dashboard running on port 1337:

```bash
npm run test:e2e:skills --prefix ./dashboard
```

This checks `/api/skills` and the Skills page filters in a headless browser (Playwright).

Review imported skills in git status before committing. You can still run **Actions → Collect Skills** for automation; the dashboard list is the primary selective UI.
