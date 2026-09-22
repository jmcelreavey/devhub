---
title: Token budget
description: Splitting always-loaded guidance from on-demand knowledge so context stays useful.
order: 10
icon: Gauge
tags: [architecture, persona]
related:
  - architecture/persona-system
  - guides/skills
---

# Token Budget

DevHub keeps AI context useful by separating always-loaded guidance from on-demand knowledge.

## Why Token Budget Matters

AI tools have limited context. Loading too much stale or irrelevant information makes sessions slower and less focused.

## Persona Layers

| Layer | Size Goal | Purpose | Where it loads |
| --- | --- | --- | --- |
| L0 Identity | Tiny (~250 tok) | Tone and how to work with JM | Cursor: `~/.cursor/rules/devhub-persona-identity.mdc`. Claude/Codex/OpenCode: marker blocks. **Not** inlined in repo `AGENTS.md`. |
| L1 Shared persona | Small (~400 tok) | Engineering standards that actually apply here | Same as L0. Repo `AGENTS.md` is a pointer. |
| L2 Deep preferences | On demand (~200 tok per mode) | Teaching, review, greenfield, DevOps, tooling | `deep-preferences` skill: SKILL.md is the index, then one `modes/<mode>.md`. |

Repo `AGENTS.md` keeps Cloud/plugin/gotcha rules only. Inlining L0/L1 there **and** in Cursor `.mdc` files loaded the same text twice.

## Notes Layers

| Layer | Purpose |
| --- | --- |
| Daily notes | Current working context |
| Learnings | Distilled reusable knowledge |
| Recap | On request via `devhub-recap` — do not volunteer session notes |

## Good Practices

- Keep always-loaded files short.
- One copy of L0/L1 per tool. Don't sync the same block into two always-on Cursor surfaces.
- Move detailed examples into on-demand docs or learnings.
- Avoid duplicating the same instruction in many places.

## What Not To Put In Persona

- Long project documentation.
- Temporary task context.
- Secrets.
- Facts that change often.
- Generic SaaS defaults this repo does not run (public REST/GraphQL, SQL migrations, Python). Those live in L2 `project-setup` / `tool-preferences`.
