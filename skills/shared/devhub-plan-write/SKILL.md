---
name: devhub-plan-write
description: Turn a draft DevHub task into a plan an agent can implement without design questions. Use when turning a draft DevHub task into an implementation plan, or when a task prompt includes a plan URL to fill in.
metadata:
  short-description: Write the plan for a draft task
---

# DevHub Plan Write

A draft task is a captured idea. Your job is to turn it into a plan that a
fast coding agent can run **without asking design questions** — or to say
clearly what is still open. You do not write code, create branches or commit.

## 1. Read what was captured

1. Curl the plan URL from the prompt (`GET /api/tasks/implement/plan?taskId=&date=`).
   It gives the task, `notePath`, links, Jira, and the linked neighbourhood.
2. `notes_read` the task note. `## Captured` is the original ask;
   `## Context snapshot` lists related notes, PRs, earlier tasks and alerts
   found at capture time. Read the ones that matter.
3. If there is a Jira key, `jira_ticket_get` it. Use `recall` for prior
   sessions on the same topic, and look at earlier *done* tasks in the snapshot:
   how was this solved last time?

## 2. Investigate until you can name the change

- **A bug or incident:** prove the cause. Read the code in the linked repo
  (read-only), check recent merges and deploys (`git log`, `gh pr list
  --state merged`), and Datadog if it's an alert (`datadog_investigate`). Name
  the change that fixes it.
- **A feature:** write the spec — behaviour, edge cases, what is out of scope.
- Link exactly one repo to the task (`tasks_update` links) if it isn't already.

An investigation that ends without a change to make is still useful: write
what you found and leave the task as a draft.

## 3. Write the plan into the task note

Read the note first and keep what's there. Add or replace:

```markdown
## Plan
- The change, in the files it touches (paths).
- Steps in order; note anything that can run in parallel or depends on another task.
- The exact commands that prove it worked (tests, lint, a curl, a query).

## Acceptance
- Observable outcomes a reviewer can check.

## Open questions
- [ ] Anything only the user can decide.
```

Write with `notes_write` (full note) — never drop existing sections. Keep it
short: the implementer reads this cold.

## 4. Ready, or not

- If `## Open questions` has unchecked items, **stop**: leave the task as a
  draft and ask the user those questions.
- Otherwise call `tasks_set_stage` with `stage: "ready"`. It runs the
  checklist (plan/acceptance, no open questions, one repo, no open
  prerequisites) and fails listing the gaps — fix them or report them. Only
  pass `force: true` if the user tells you to.

Finish with a three-line summary: the cause or spec, the change, and whether
the task is now ready.
