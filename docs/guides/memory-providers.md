---
title: Memory providers
description: Switch this machine between agentmemory, claude-mem or no agent memory at all, with one command each way.
order: 19
icon: Database
tags: [agents, setup]
related:
  - architecture/recall
  - architecture/mcp-server
  - guides/repo-conventions
---

# Memory providers

Agent memory tools capture what an agent did, compress it, and feed the relevant bits back into later sessions. DevHub's own [Recall](../architecture/recall.md) is a different thing (your notes, tasks and commits), and it stays on whichever provider you pick.

Run one provider at a time. Two both injecting remembered context into the same session is noise, and two both capturing the same work costs twice.

```bash
npm run memory -- status
npm run memory -- use claude-mem
npm run memory -- use agentmemory
npm run memory -- use none
npm run memory -- use agentmemory --dry-run   # print the plan, change nothing
```

`use X` turns every other provider off first, then turns X on. For agentmemory:

- agentmemory's MCP entry is parked as `~/.config/devhub/mcp-personal/agentmemory.json.disabled` (DevHub only reads `*.json`), so DevHub's sync stops writing it to your tools.
- Its launchd job is disabled, not removed, and `~/.agentmemory` is never touched.
- A failed step stops the switch and says which one. Steps that are expected to fail sometimes (already stopped, already added) are marked `(ignored)`.

## What each one does to the machine

| | agentmemory | claude-mem |
| --- | --- | --- |
| Where it hooks in | MCP server in Claude Code, Cursor, Codex, OpenCode, Claude Desktop and Antigravity; an OpenCode capture plugin | Claude Code plugin with lifecycle hooks, plus a local worker on `:37702` |
| Always-on process | `dev.agentmemory` launchd job (node plus the `iii` engine on `:3111`) | The worker, started by `npx claude-mem start` |
| Data | `~/.agentmemory` | `~/.claude-mem` |
| Extra installs | none | Bun and uv, if missing |

DevHub installs claude-mem for **Claude Code only**, pinned to `13.29.0`. Safe-Chain holds back newer releases until they're old enough; leave it. To add another editor later, run `npx claude-mem install --ide <id>` yourself (`cursor`, `opencode`, `codex-cli`, …) and check what that one writes first.

## claude-mem: the provider matters

DevHub passes `--provider claude` to the installer and stores memory under `~/.claude-mem`. Claude handles compression, so local memory storage doesn't mean offline inference. Background compression uses your Claude account; watch that usage during a trial.

The script also disables telemetry and leaves Claude Code's native auto-memory alone.

Use `npm run memory -- status` to check the selected provider and worker. claude-mem's live view is `http://127.0.0.1:37702`.

## Swapping back

`npm run memory -- use agentmemory` runs, in order: stop and uninstall claude-mem, restore the MCP entry, re-sync it to the other tools (add only, no prune), add it to Claude Code with `claude mcp add`, and re-enable the launchd job. Restart your editors afterwards so they pick the MCP server up again.

## Notes

- The sync that removes agentmemory from the other tools is the same one as the dashboard's MCP **Sync** button, run per tool with `--exclude node_repl --exclude computer-use`. Those two come from the Codex app, look exactly like DevHub's servers, and a plain prune deletes them. `scripts/install_mcp_configs.ts` takes `--tool`, `--exclude`, `--no-prune` and `--dry-run` for exactly this.
- Claude Code's own config (`~/.claude.json`) is changed through `claude mcp`, not by rewriting the file, because Claude Code writes it constantly.
- The OpenCode capture plugin (`~/.config/opencode/plugins/agentmemory-capture.ts`) is left in place. With agentmemory off it fails quietly on a closed port.
- macOS only for the launchd steps; they're skipped elsewhere.
