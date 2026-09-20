---
title: Agents (AionUi)
description: How DevHub embeds AionUi for coding agents, background jobs, MCP, and Graphite Neon theming.
order: 4
icon: Bot
tags: [agents, aionui, mcp]
related:
  - guides/auto-pr-review
  - guides/skills
  - guides/opencode-and-chamber
  - architecture/mcp-server
  - reference/environment-variables
  - plans/agents-workspace
---

# Agents (AionUi)

The dashboard **Agents** page (`/agents`) embeds a managed [AionUi](https://github.com/iOfficeAI/AionUi) workspace. DevHub starts conversations through AionCore, tracks runs in Agent Activity, and owns scheduling / PR automation. AionUi owns the chat UI, streaming, and native harness permissions.

Pinned release: **AionUi 2.2.2** + **AionCore 0.2.2** (authenticated WebUI on loopback, typically `:25818` / core `:25819`).

## What DevHub launches use

Anything DevHub fires into AionUi (auto-PR review, schedules, MCP `agent_dispatch`, Implement / Resume when routed through Agents) gets:

| Setting | Default | Source |
| ------- | ------- | ------ |
| Assistant | **Cursor** | `DEVHUB_AGENT_CLI` (fallback: Agents “default agent”) |
| Model | **Grok 4.6 high** (`grok-4.6[effort=high]`, fast off) | `DEVHUB_AION_CURSOR_MODEL` or mapped from `DEVHUB_AGENT_CURSOR_MODEL` |
| Permission | **Per-harness YOLO** | Claude `bypassPermissions`, Codex `agent-full-access`, Gemini/Aion `yolo`, OpenCode `build`, Antigravity `yolo`, **Cursor `yolo`** (AionCore `yolo_id`; session catalog is still agent/plan/ask), Copilot `autopilot` |
| Auto-confirm | Cursor/Copilot ACP prompts | Backstop: reconciliation `allow-always`s leftover confirmations on DevHub-managed chats |
| MCP attach | Every enabled non-builtin AionUi MCP server | Passed as `mcp_ids` / `selected_mcp_server_ids` on conversation create |
| Theme | **Graphite Neon** | DevHub graphite tokens (`#111416` / `#9ed84a`); CSS kills Arco blues in managed WebUI |
| CSRF | Fetch bridge | Injected into managed `index.html` so iframe POSTs send `x-csrf-token` |

Free-form chats you start inside the AionUi iframe use that UI’s own picker; they are not forced through the table above.

Finished **Review with agent** / auto-review conversations are archived in AionUi’s sidebar when the run completes, fails, or is cancelled, so they don’t pile up in the active chat list. Agent Activity still keeps the run.

### Thinking / effort level

- **Cursor + Grok:** baked into the model id (e.g. `grok-4.6[effort=high]` or `grok-4.6[effort=high,fast=true]`). Open the **model chip** in the composer (brain icon) and pick a Grok variant — effort/fast are part of the id, not a separate toggle on Aion CLI. Or set `DEVHUB_AION_CURSOR_MODEL`.
- **Aion CLI / other models:** if the harness advertises it, open the model or **Default** (shield) runtime control for Thinking Level / Reasoning Effort. Luna models may not show Grok-style effort/fast switches.
- **Other harnesses:** when advertised, the runtime pill exposes **Thinking Level** / **Reasoning Effort**.

## MCP

DevHub’s MCP catalog syncs into AionUi via `syncMcpServers` → `syncAionMcpServers` (entries tagged `[DevHub managed]`).

On **Agents connect / managed setup**, DevHub also **enables** those managed servers (`ensureAionMcpBootstrap`). Sync alone used to leave them disabled, so Agents could not call notes/tasks/PRs until you toggled them by hand.

New DevHub→AionUi conversations **attach every enabled non-builtin MCP server** (managed catalog plus personal ones such as `lean-ctx`) so Agents get `ctx_search` and the rest, not an empty `mcp_server_ids` list.

Cursor ACP still has a ~190-tool cap. Sync slims the attached `devhub` process (`DEVHUB_MCP_TOOLSETS`), launches Playwriter through a compact stdio wrapper, and pins `lean-ctx` to `standard`. Reload Cursor MCP after sync or `execute` / `ctx_search` stay missing. See [MCP Server — Cursor ACP tool budget](../architecture/mcp-server.md#cursor-acp-tool-budget).

After **Sync MCP** from Agents → MCP (or bootstrap install), confirm `devhub` (and any personal servers you want) show enabled in AionUi’s MCP list. Reconnect Agents if a new sync left them off on an older build.

Skills sync to `~/.local/share/devhub/aionui/data/skills` (see [Skills](skills.md)).

## Persona paths

Non-Cursor agents that load L0/L1 from disk must read repo-root:

- `persona/identity.txt`
- `persona/shared-persona.md`

Never `notes/persona/`. Cursor already gets L0/L1 from `~/.cursor/rules/devhub-persona-*.mdc`.

## Setup

1. Open **Agents** and run managed setup (or connect an existing loopback WebUI).
2. Hard-refresh the iframe after updates so CSRF + Graphite Neon CSS load.
3. Prefer **Cursor** as the Agents default for background work (matches `DEVHUB_AGENT_CLI=cursor`).
4. Run **Sync MCP** / **Sync skills** when the catalog changes.

## Related code

| Area | Path |
| ---- | ---- |
| Dispatch + YOLO / model defaults | `dashboard/lib/agent-runs/dispatch.ts`, `dashboard/lib/aionui/dispatch-defaults.ts` |
| Background / auto-review entry | `dashboard/lib/agent-runs/background.ts`, `dashboard/lib/github/auto-pr-review.ts` |
| Theme + CSRF patches | `dashboard/lib/aionui/theme.ts`, `scripts/aionui-apply-web-patches.mjs` |
| MCP sync / enable | `dashboard/lib/sync/aionui-mcp.ts`, `dashboard/lib/aionui/mcp-bootstrap.ts` |
| MCP tools | `agent_list`, `agent_dispatch`, `agent_race`, `agent_runs`, … in `mcp-servers/devhub-server` |

See the implementation plan: [Agents workspace](../plans/agents-workspace.md).
