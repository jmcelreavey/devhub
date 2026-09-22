---
name: deep-preferences
description: Load one DevHub L2 persona mode. Use when the task is teaching or explaining a concept, reviewing code or a PR, scaffolding a new project, deploy/infra/CI work, or choosing tooling (package manager, editor, Python/JS setup).
metadata:
  short-description: Load one L2 persona mode file
---

# Deep Preferences (L2)

Read **one** mode file from this skill's `modes/` directory for the active
intent. Do not read every mode. Unsure → skip.

| Mode | File | Trigger hints |
|------|------|----------------|
| Teaching | `modes/teaching.md` | explain, teach, how does, walk through, ELI5 |
| Code review | `modes/code-review.md` | review, PR, diff, feedback |
| Project setup | `modes/project-setup.md` | scaffold, new project, bootstrap, greenfield |
| Deployment & DevOps | `modes/deployment-devops.md` | deploy, k8s, terraform, CI/CD, infra |
| Tool preferences | `modes/tool-preferences.md` | package manager, editor, Python/JS tooling |

Writing code, debugging, and working in existing codebases are covered by the
always-on L1 persona — there is no mode file for them.
