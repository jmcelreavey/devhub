# Persona System

The persona system keeps AI assistant behavior consistent across tools.

Instead of rewriting instructions in every app, DevHub stores shared persona files and syncs them to supported tools.

## Persona Layers

| Layer | File | Purpose | Loaded when |
| ----- | ---- | ------- | ----------- |
| L0 Identity | `persona/identity.txt` | Tone, role, how to work with you | Every message (keep small) |
| L1 Shared persona | `persona/shared-persona.md` | Engineering standards | Every session |
| L2 Deep preferences | `persona/deep-preferences.md` + `persona/modes/*.md` | Teaching, review, debug, etc. | On demand via `deep-preferences` skill |

L0 and L1 are synced to tool configs and repo `AGENTS.md` (marker blocks). L2 is **not** synced.

This layered approach keeps always-loaded instructions small while preserving richer guidance when it is useful.

## What Belongs In Persona

Good persona guidance includes:

- Communication preferences.
- Engineering standards.
- Review style.
- Debugging approach.
- Security expectations.
- Tool usage preferences.

Avoid adding project facts that change often. Those belong in docs, notes, or code comments.

## Persona Tab (Dashboard)

**Agents → Persona** is the editor for L0–L2 sources and a read-only view of synced targets.

| Card | Editable | Notes |
| ---- | -------- | ----- |
| Shared persona (L1) | Yes | `persona/shared-persona.md` — engineering standards |
| Identity (L0) | Yes | `persona/identity.txt` — keep very small |
| Deep preferences (L2) | Index only | `persona/deep-preferences.md` plus `persona/modes/*.md` — not synced; load via `deep-preferences` skill |
| AGENTS.md, Claude, Codex, OpenCode, Cursor | No (synced) | Marker blocks written by sync; use **Synced output** to preview |

The list shows token estimates for each source file (L2 total includes all mode files). Expand a source card to edit inline; saves go through `PUT /api/persona` with `{ id, content }` (source targets only).

**Pull from tool** copies a marker block from a local tool file back into a source when you edited outside DevHub. **Synced output** compares what landed in each tool without opening dotfiles.

## L2 Mode Files

Mode files under `persona/modes/` are listed in `persona/deep-preferences.md` with trigger hints. The assistant should load **only** matching mode file(s) via the `deep-preferences` skill — never load the full modes directory by default.

| Mode | File |
| ---- | ---- |
| Teaching | `persona/modes/teaching.md` |
| Writing code | `persona/modes/writing-code.md` |
| Code review | `persona/modes/code-review.md` |
| Debugging | `persona/modes/debugging.md` |
| Project setup | `persona/modes/project-setup.md` |
| Deployment & DevOps | `persona/modes/deployment-devops.md` |
| Tool preferences | `persona/modes/tool-preferences.md` |
| Existing codebases | `persona/modes/existing-codebases.md` |

See [Token Budget](../TOKEN_BUDGET.md) for why L2 stays off the sync path.

## Syncing Persona

After editing persona files, run **Sync to all tools** on the Agents → Persona tab (or `sync_native_persona`).

Sync writes marker blocks into:

- Repo `AGENTS.md` (L0 + L1)
- `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.opencode/AGENTS.md`
- `~/.cursor/.cursorrules` (legacy)
- `~/.cursor/rules/devhub-persona-identity.mdc` and `devhub-persona-shared.mdc` (always-on Cursor rules)

Use **Synced output** on the Persona tab to preview what landed without opening dotfiles.

## Maintenance Tips

- Keep the identity layer very small.
- Keep the shared persona stable and general.
- Put niche preferences in the deep layer.
- Remove instructions that no longer affect real work.
- Avoid duplicating the same rule in multiple layers.
