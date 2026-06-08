# Shared Agents

Shared agents are reusable subagent personas synced from `agents/shared/` into local tool directories (Cursor, Codex, OpenCode, and others). The dashboard **Agents → Agents** tab lists the catalog and runs **Sync agents**.

## When To Use An Agent Vs A Skill

| Artifact | Use for |
| --- | --- |
| **Skill** (`skills/shared/`) | Workflow the *current* agent loads inline when relevant (checklists, commands, procedures). |
| **Agent** (`agents/shared/`) | Delegated specialist with isolated context — exploration, domain depth, or read-only investigation. |

If the work is mostly "follow these steps in this conversation," prefer a skill. If the work needs a separate pass or a narrow expert hat, prefer an agent.

## Canonical Format (repo)

One markdown file per agent: `agents/shared/<slug>.md`. Edit this form in git; **sync rewrites frontmatter per tool**.

```markdown
---
name: my-agent
description: One-line role. Use when <concrete triggers so the parent agent delegates reliably>.
mode: subagent
readonly: true
---

Body: role, when called, workflow, rules, output shape, related skills (by name).
```

| Field | Purpose |
| --- | --- |
| `description` | **Required.** Include "Use when …" triggers. |
| `mode` | Always `subagent` for catalog agents. |
| `readonly` | `true` = no file edits (discovery, CI triage); `false` = may implement. |

Do **not** put `tools:`, `model:`, or `permission:` in the repo copy — sync derives those.

## Per-Platform Output (at sync)

| Target | Frontmatter |
| --- | --- |
| **OpenCode** (`.config/opencode/agent`, `agents`) | `mode: subagent`, `permission:` (`edit` / `bash` from `readonly`) |
| **Cursor** (`.cursor/agents`) | `readonly`, `is_background: false` |
| **Codex / Claude / config-ai** | Same as Cursor |

Prune on sync removes tool-dir agents that are no longer in the catalog (e.g. retired agents).

## Catalog Maintenance

- **Create** from the dashboard or add a file under `agents/shared/`.
- **Collect** imports local-only agents from tool dirs and **canonicalizes** them (strips `permission:` / `tools:` / Cursor-only fields into `readonly`).
- **Sync agents** writes platform-specific frontmatter to each target.
- **Validate** checks `description`, `mode: subagent`, and flags legacy `tools:` / `model:` in repo files.

After edits, run **Sync agents** so local tools pick up changes.

## Core Agents

| Agent | Focus |
| --- | --- |
| `repo-navigator` | Read-only codebase orientation and handoffs |
| `devhub-specialist` | DevHub repo, sync, notes MCP |
| `ci-investigator` | Single failing PR CI check |

Domain-specific specialists (content, commerce, infrastructure, subscription, etc.) can
be supplied by **plugins** — they appear in the catalog as read-only agents tagged with
their plugin. See [Plugins](../architecture/plugins.md). See each file under
`agents/shared/` for repo lists and debugging order.
