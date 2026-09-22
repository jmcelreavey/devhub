---
title: Persona system
description: Layered instruction files that keep assistant behaviour consistent across every tool.
order: 7
icon: UserRound
tags: [architecture, persona]
related:
  - architecture/token-budget
  - guides/skills
---

# Persona System

The persona system keeps AI assistant behavior consistent across tools.

Instead of rewriting instructions in every app, DevHub stores shared persona files and syncs them to supported tools.

## Persona Layers

| Layer | File | Purpose | Loaded when |
| ----- | ---- | ------- | ----------- |
| L0 Identity | `persona/identity.txt` | Tone, role, how to work with you | Every message (keep small) |
| L1 Shared persona | `persona/shared-persona.md` | Engineering standards | Every session |
| L2 Deep preferences | `skills/shared/deep-preferences/modes/*.md` | Teaching, review, greenfield, DevOps, tooling | On demand — via the `deep-preferences` skill |

L0 and L1 sync to Claude/Codex/OpenCode marker blocks and Cursor `~/.cursor/rules/devhub-persona-*.mdc`. Repo `AGENTS.md` gets a **pointer**, not the full text, so Cursor does not load L0/L1 twice. L2 syncs as the `deep-preferences` skill, so the mode files resolve in every repo, not just this one.

## What Belongs In Persona

Good persona guidance includes:

- Communication preferences.
- Engineering standards that apply to the work you actually do.
- Review style.
- Debugging approach.
- Security expectations.

Avoid adding project facts that change often. Those belong in docs, notes, or code comments. Avoid generic SaaS defaults (public API versioning, SQL migrations) in L1 — put them in L2 `project-setup` / `tool-preferences`.

## Persona Tab (Dashboard)

**Agents → Persona** is the editor for L0–L2 sources and a read-only view of synced targets.

| Card | Editable | Notes |
| ---- | -------- | ----- |
| Shared persona (L1) | Yes | `persona/shared-persona.md` — engineering standards |
| Identity (L0) | Yes | `persona/identity.txt` — keep very small |
| Deep preferences (L2) | Index only | `skills/shared/deep-preferences/SKILL.md` plus `modes/*.md` — synced as a skill |
| AGENTS.md, Claude, Codex, OpenCode, Cursor | No (synced) | Marker blocks written by sync; use **Synced output** to preview |

The list shows token estimates for each source file. Expand a source card to edit inline; saves go through `PUT /api/persona` with `{ id, content }` (source targets only).

**Pull from tool** copies a marker block from a local tool file back into a source when you edited outside DevHub. **Synced output** compares what landed in each tool without opening dotfiles. Pull from Cursor uses `~/.cursor/.cursorrules` (full text), not the AGENTS.md pointer.

## L2 Mode Files

Mode files live in `skills/shared/deep-preferences/modes/`, indexed by that skill's `SKILL.md`. They used to sit under `persona/modes/`, which only resolved when the agent was working inside this repo. Open **only** the matching file.

| Mode | File |
| ---- | ---- |
| Teaching | `modes/teaching.md` |
| Code review | `modes/code-review.md` |
| Project setup | `modes/project-setup.md` |
| Deployment & DevOps | `modes/deployment-devops.md` |
| Tool preferences | `modes/tool-preferences.md` |

Writing code, debugging, and existing-codebase guidance live in L1.

See [Token Budget](token-budget.md) for why L2 stays off the sync path.

## Syncing Persona

After editing persona files, run **Sync to all tools** on the Agents → Persona tab (or `sync_native_persona`).

Sync writes:

- Repo `AGENTS.md` — L0/L1 **pointers** (not full text)
- `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.opencode/AGENTS.md` — full L0/L1
- `~/.gemini/GEMINI.md` — full L0/L1 (Antigravity)
- `~/.cursor/.cursorrules` — full L0/L1 (legacy; Cursor does not always-apply this)
- `~/.cursor/rules/devhub-persona-identity.mdc` and `devhub-persona-shared.mdc` — full L0/L1, `alwaysApply: true`

Use **Synced output** on the Persona tab to preview what landed without opening dotfiles.

## Maintenance Tips

- Keep the identity layer very small.
- Keep the shared persona stable and general.
- Put niche preferences in the deep layer.
- Remove instructions that no longer affect real work.
- Avoid duplicating the same rule in multiple always-on surfaces.
