---
name: deep-preferences
description: Load context-specific persona modes from persona/modes/ when teaching, code review, debugging, scaffolding, DevOps, or similar tasks. Use when the session needs L2 guidance beyond identity and shared-persona.
metadata:
  short-description: Load on-demand persona modes
---

# Deep Preferences (L2)

## Overview

DevHub splits persona into layers. **L0** (`persona/identity.txt`) and **L1** (`persona/shared-persona.md`) load automatically via sync. **L2** mode files load **only when relevant** — this skill decides which file(s) to read.

## When To Use

Use this skill when the user's intent clearly matches one or more modes in `persona/deep-preferences.md` (the index), for example:

- Explaining a concept → **teaching**
- Reviewing a PR or diff → **code-review**
- Investigating errors or failing tests → **debugging**
- Implementing or fixing code in an existing repo → **writing-code**
- Greenfield scaffold → **project-setup**
- Deploy / infra / CI → **deployment-devops**
- Tooling choices → **tool-preferences**
- Working in a legacy or unfamiliar codebase → **existing-codebases**

Do **not** load L2 for routine questions that L0/L1 already cover.

## Workflow

1. Read `persona/deep-preferences.md` (index) if you need the mode → file mapping.
2. From the user's message and recent context, pick **one or more** matching modes.
3. Read **only** the corresponding files under `persona/modes/` (e.g. `persona/modes/code-review.md`). Do not read every mode file.
4. Apply that guidance for the rest of the task. Re-read a mode file if the task shifts (e.g. from implement to review).

## Principles

- Minimal context: one mode file is usually enough.
- Mode files win over generic defaults for that activity only.
- L0 identity still applies for tone; L1 shared-persona still applies for engineering standards.
- If unsure whether a mode applies, skip L2 rather than loading everything.

## Mode files

| File | Purpose |
|------|---------|
| `persona/modes/teaching.md` | Explanations and walkthroughs |
| `persona/modes/writing-code.md` | Implementation in existing repos |
| `persona/modes/code-review.md` | PR/diff review |
| `persona/modes/debugging.md` | Bugs and failures |
| `persona/modes/project-setup.md` | New projects |
| `persona/modes/deployment-devops.md` | Deploy and infrastructure |
| `persona/modes/tool-preferences.md` | Tooling choices |
| `persona/modes/existing-codebases.md` | Legacy / incremental work |
