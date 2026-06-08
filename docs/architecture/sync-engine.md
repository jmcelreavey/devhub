# Sync Engine

The sync engine keeps AI tool configuration consistent across machines and tools.

## What It Syncs

| Asset           | Source In Repo         | Destination                     |
| --------------- | ---------------------- | ------------------------------- |
| Skills          | `skills/shared/` plus optional [ai-tools](https://github.com/example-org/ai-tools) checkout | Local tool skill directories    |
| Agents          | Shared agent files     | Local tool agent directories    |
| Persona         | Persona files          | Tool-specific instruction files |
| MCP configs     | `mcp/shared/*.json`    | `~/.claude.json`, `~/.codex/mcp.json`, `~/.cursor/mcp.json`, OpenCode `mcp` block |
| OpenCode config | `opencode/shared/opencode.json` | `~/.config/opencode/opencode.json` (curated keys only) |

Only `model`, `small_model`, `provider`, and `theme` are merged. MCP entries, schema, and agent metadata that OpenCode maintains locally are preserved. Provider credentials use `{env:VAR}` in the repo; sync resolves them from the environment (including 1Password-backed vars) into the local file.

DevHub `skills/shared/` is the source of truth for personal and dotfiles skills. BI company skills stay canonical in **ai-tools**; DevHub reads a local clone (default `~/Developer/ai-tools`) and merges at sync time. DevHub wins when the same skill name exists in both trees.

**Plugins generalise this.** Skills, agents, and MCP configs can also come from registered **plugins** (separate repos, e.g. the private `devhub-bi`), merged at sync time with the same "core wins on collision" rule and marked read-only. See [`plugins.md`](plugins.md) for the manifest, the machine-local registry (`~/.config/devhub/plugins.json`), and precedence (core → ai-tools → plugins).

Environment:

| Variable | Purpose |
| -------- | ------- |
| `AI_TOOLS_ROOT` | Path to ai-tools clone (default `~/Developer/ai-tools`) |
| `AI_TOOLS_SYNC=0` | Disable upstream merge |
| `AI_TOOLS_REFRESH_ON_SYNC=0` | Skip upstream skills fetch during sync (offline-friendly; uses last cache or local checkout) |
| `AI_TOOLS_BRANCH` | Branch to fetch skills from (default: repo default branch via `gh repo view`) |

On **Sync skills**, DevHub may fetch the ai-tools default branch into `~/.cache/devhub/ai-tools-upstream/` (uses GitHub CLI auth; does not modify your checkout), then copies the merged catalog. Opening the **Skills** tab also fetches upstream once per visit (background; shows last cached catalog until the fetch finishes).

**Exclude (eye icon):** excluded skills/agents/MCP servers are not copied on sync and are not pruned; local copies stay until you delete them or include the entry again.

**Prune:** off by default for skills, agents, and MCP. Enable prune to remove local entries that are no longer in the repo catalog (recognized shapes only).

**Cursor MCP path:** DevHub syncs to `~/.cursor/mcp.json` (where Cursor stores user MCP servers such as agentmemory). A legacy `~/.config/cursor/mcp.json` is merged on read and cleared after sync.

**Personal MCP catalog:** Machine-local definitions under `~/.config/devhub/mcp-personal/` sync to every tool like `mcp/shared/` but are never committed — use for agentmemory, remote HTTP entries, or other per-machine setup.

## Sync Vs Collect

DevHub uses two directions:

| Direction | Meaning                                           |
| --------- | ------------------------------------------------- |
| Sync      | Copy from the repo into local AI tool directories |
| Collect   | Copy useful local tool changes back into the repo |

Use sync after pulling changes or editing shared assets in the repo.

Use collect when you created something in a local tool and want to preserve it in DevHub.

## Update And Sync

The full update flow usually does four things:

1. Checks the repo state.
2. Pulls remote changes when safe.
3. Syncs shared assets to local tools.
4. Optionally commits and pushes collected changes.

This keeps machines aligned without requiring every tool to be configured by hand.

## Safety Rules

- Avoid syncing real secrets into shared config.
- Use environment variable placeholders for credentials.
- Keep shared assets broadly useful, not machine-specific.
- Review collected local assets before committing them.

## When To Use It

| Situation                       | Action             |
| ------------------------------- | ------------------ |
| You pulled DevHub updates       | Run sync           |
| A skill is missing in a tool    | Run skill sync     |
| You wrote a useful local skill  | Run collect skills |
| Persona changes are not visible | Run persona sync   |
| MCP tools are stale             | Run MCP sync       |
