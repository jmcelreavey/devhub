---
name: deep-preferences
description: Load one DevHub persona mode. Use when teaching or explaining, reviewing code or PRs, scaffolding a project, doing deploy, infra or CI work, or choosing tooling.
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
