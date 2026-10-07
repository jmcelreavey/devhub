---
title: Skills
description: "Reusable agent instructions: authoring them, syncing them, and where each tool picks them up."
order: 2
icon: Sparkles
tags: [agents]
related:
  - guides/agents
  - architecture/sync-engine
  - guides/plan-loop
  - guides/vendored-skills
---

# Skills

Skills are reusable instructions for AI agents. They capture repeatable workflows, checklists, and domain-specific guidance.

## Where Skills Live

Shared skills live in the DevHub repo under `skills/shared/` and can be synced into local AI tools. Retired skills live under `skills/parked/` — they stay in git for reference, and sync **uninstalls** matching copies from tool directories (see [Retiring a skill](#retiring-a-skill)). Vendored third-party skills live under `skills/vendor/` ([Vendored skills](vendored-skills.md)).

Optional shared/team skills can live in an **ai-tools** checkout under `skills/`. DevHub merges them at sync time from a local clone and exposes them with a `bi-` catalog prefix unless they already have one. They appear on the Skills page with an **ai-tools** badge and are read-only in DevHub (edit them in ai-tools, then **Refresh** or run sync).

Each skill should have a clear name and a `SKILL.md` file that explains when and how to use it.


| Tool | User skill root |
| ---- | --------------- |
| Claude | `~/.claude/skills` |
| Codex | `~/.codex/skills` |
| OpenCode | `~/.opencode/skills`, `~/.config/opencode/skills` |
| Cursor | `~/.cursor/skills` and `~/.agents/skills` |
| Antigravity | `~/.gemini/config/skills` |

Cursor Customize → Skills lists `~/.agents/skills` as **User**. `~/.cursor/skills-cursor` is Cursor's internal builtin store — never a sync target. Antigravity also gets a generated `~/.gemini/config/skills/index.json` listing synced skills.


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

Skill sync reads `skills/shared/` from the **linked DevHub checkout**, not from app-data. On the installed desktop app without a linked checkout, **Sync skills** fails with "No linked git checkout" — attach a checkout (**View → Attach to Dev Server…**) or run sync from a browser session rooted in the repo. See [Scripts — Linked checkout requirement](../reference/scripts.md#linked-checkout-requirement).

Use the source filter (**All / DevHub / ai-tools / Local**) and the eye control to exclude catalog skills from sync and prune.

### Sync preview before sync

Before syncing skills or agents, the dashboard can show what would change without applying it:

- **Skills → Skills / Agents tabs** — preview runs when you open sync controls (`GET /api/sync-preview?kind=skill` or `?kind=agent`).
- **Status → Skill sync** — when `GET /api/sync-health` reports `healthy: false`, embedded previews explain missing or drifted entries.

Preview response fields:

| Field | Meaning |
| ----- | ------- |
| `targets[].writes` | Files that would be created or updated (`reason`: `missing` or `changed`) |
| `targets[].prunes` | Local entries that would be removed when prune is enabled |
| `targets[].unchanged` | Count of entries already in sync |
| `excluded` | Slugs skipped via the eye icon or `exclude=` query param |

Preview is read-only. It does not replace `dry_run_scoped_sync` (that action previews **content** git paths only). See [Sync Engine](../architecture/sync-engine.md#preview-without-applying).

## Retiring a skill

Move it, don't delete it:

```bash
git mv skills/shared/<slug> skills/parked/<slug>
```

Add a row to `skills/parked/README.md` saying why. The next **Sync skills** removes that name from every tool directory (`REMOVED PARKED`) when the installed copy still matches the parked tree. A copy the user edited locally is left alone (`KEPT PARKED`). Parking is the only way to uninstall without turning prune on — prune stays off because tool directories also hold skills DevHub does not own.

The plan-loop retro (`devhub-retro` / `GET /api/tasks/retro`) lists Claude Code invocation counts over 30 days, least-used first, as retirement candidates. A zero means unused in Claude Code transcripts, not unused in Cursor / Codex / OpenCode.

## Skills launched from the dashboard

Some dashboard actions preload a skill. Review-with-agent starts an AionUi conversation; git hook/conflict fix still go through the terminal dock:

| Skill | Triggered from | Purpose |
| ----- | -------------- | ------- |
| `pr-explain-review` | `/prs` **Review with agent** | Explain a GitHub PR and save a review note under `notes/pr-reviews/…`. Starts a Paseo agent, not a PTY inject. See [GitHub integration](../integrations/github.md#row-actions). |
| `git-hook-fix` | Repo Git **GitHookFailureDialog** | Diagnose and fix pre-commit/pre-push hook failures after a `422 hook_failed` response. |
| `git-conflict-resolve` | Repo Git stash conflicts | Walk through resolving conflict markers after a failed stash apply/pop (`409 stash_conflict`). |
| `taste-skill` | Briefing canvas generation (house aesthetic) | Anti-slop frontend rules distilled into briefing prompts via `lib/briefing-taste.ts`. Install under `skills/shared/` (or sync to tool paths) for stricter default palettes; **fresh look** / custom aesthetics bypass house rules until reset. |
| `impeccable` / `ui-ux-pro-max` | Product UI polish / searchable design DB | Prefer these over `frontend-design` / `hallmark` for general UI work. Keep `taste-skill` for briefing canvas. |
| `my-voice` | Human-facing prose as John | `explain-simply` for chat; `full-voice` for all prose written on John's behalf, including tasks, tickets, notes, docs, PRs, commits, email, and Slack. |
| `vercel-react-best-practices` / `web-design-guidelines` | Next.js dashboard UI | Vercel-labs skills for DevHub dashboard work. |

Configure the underlying provider (`cursor-cli`, `chatgpt-cli`, `antigravity-cli`, `opencode`, or `api`) from **/setup → AI Provider**. See [Terminal and agent CLI](terminal-and-agent-cli.md#agent-cli-selection).

## Training my-voice

`/voice` is a quiz that teaches the `my-voice` skill how you actually write. Open it from **Skills → Train my voice**, or with ⌘P → "My voice".

1. Answer the scenarios in your own words. Each answer saves as you go to `notes/voice/answers.json`, so it stays in your notes vault rather than the code.
2. Hit **Update my voice**. Your AI provider distils the new answers into `skills/shared/my-voice/learned-voice.md` and DevHub shows you the draft. Nothing is written yet.
3. Edit the draft if it's off, then save. DevHub writes the file and syncs just that skill out to your agent tools.

How it fits together:

- `writing-style.md` is hand-written and the trainer never touches it. `learned-voice.md` belongs to the trainer and is rewritten each round. Where they disagree, `learned-voice.md` wins.
- In-app writers (commit messages, work-item titles, notes AI) read both files on every request, so they pick up an update straight away.
- A draft can take a minute or two on a CLI provider. If the reply isn't a usable document you get the start of it in the error. Run it again.
- Editing an answer after a draft was made makes that draft stale. Saving it is refused until you generate a new one.

From an agent, the same loop is `voice_list`, `voice_answer`, `voice_train` and `voice_apply` (see [MCP server](../architecture/mcp-server.md)). The agent asks you for each answer and records it verbatim. `voice_train` starts the draft in the background and is polled for the result. `voice_apply` needs `confirm:true`, and the agent should only pass it once you've seen the draft.

## MCP tab

Sidebar **Agents** → tab **MCP** manages the MCP catalog:

| Scope | Storage | Synced to tools |
| ----- | ------- | --------------- |
| Repo | `mcp/shared/<name>.json` | Yes — committed with DevHub |
| Personal | `~/.config/devhub/mcp-personal/<name>.json` | Yes — machine-local, never committed |

Use **New server** to create an entry, or **Import** (`GET /api/mcp/local`) to copy from an existing tool config. The eye icon excludes a server from forward sync and prune (same semantics as skills). **Sync MCP** on Actions runs the MCP sync action.

**Catalog vs runtime:** `/api/mcp*` edits JSON configs. `/api/status/mcp` (Status page) only inspects running processes for `mcp/shared/` entries. Plugin and personal servers sync to AI tools but do not appear on Status.

## Collecting Skills (add to catalog)

On the **Skills → Skills** tab, the catalog list includes **local-only** rows (skills that exist under `~/.codex/skills`, `~/.claude/skills`, etc. but not yet in `skills/shared/`).

- **Add to catalog** on a row copies that skill into `skills/shared/` and stages it with git.
- Use checkboxes and **Add selected to catalog** for bulk import.
- Rows with a migration badge (e.g. local newer, diverged) already exist in the catalog but differ from your local copy — import overwrites per the same rules as **Collect Skills** in Actions.

The same pattern applies on **Skills → Agents** for `agents/shared/`. See [Shared Agents](agents.md) for subagent format and the current specialist catalog.

### Smoke test (local)

With the dashboard running on port 1337:

```bash
npm run test:e2e:skills --prefix ./dashboard
```

This checks `/api/skills` and the Skills page filters in a headless browser (Playwright).

Review imported skills in git status before committing. You can still run **Actions → Collect Skills** for automation; the dashboard list is the primary selective UI.
