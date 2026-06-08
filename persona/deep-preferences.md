# Deep Preferences (L2) — Load On Demand

Context-specific guidance lives under `persona/modes/`. **Do not load this index or every mode file by default.**

Use the **`deep-preferences`** skill when the session matches a mode below. Read **only** the listed file(s) for the active mode(s).

| Mode | File | Trigger hints |
|------|------|----------------|
| Teaching | `persona/modes/teaching.md` | explain, teach, how does, walk through, ELI5 |
| Writing code | `persona/modes/writing-code.md` | implement, build, fix, write code |
| Code review | `persona/modes/code-review.md` | review, PR, diff, feedback |
| Debugging | `persona/modes/debugging.md` | debug, error, failing test, broken |
| Project setup | `persona/modes/project-setup.md` | scaffold, new project, bootstrap, greenfield |
| Deployment & DevOps | `persona/modes/deployment-devops.md` | deploy, k8s, terraform, CI/CD, infra |
| Tool preferences | `persona/modes/tool-preferences.md` | package manager, editor, terminal choice |
| Existing codebases | `persona/modes/existing-codebases.md` | legacy, refactor, match style, incremental |

If multiple modes apply (e.g. review + debug), load each matching file. Skip modes that do not match the user's intent.
