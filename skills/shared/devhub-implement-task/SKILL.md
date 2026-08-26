---
name: devhub-implement-task
description: >-
  Implement a DevHub task end-to-end: gather context (task, tags, linked
  notes/resources, Jira ticket), move a New/To Do/Open Jira ticket to In
  Progress when work starts, write the code with minimal diffs and no
  unnecessary comments,
  verify, then walk a post-implementation checklist - asking before each step
  (commit/push, PR, PR review note, Jira Code Review transition, completing
  the DevHub task). Use when a DevHub task's "Implement with Agent" action
  launched you with a plan URL, or when the user asks to implement a task
  from DevHub.
metadata:
  short-description: Implement a DevHub task end-to-end
---

# DevHub Task Implementation

## Overview

Take one DevHub task from "text in a list" to "implemented, verified, and
handed back to the human". Three rules govern everything:

1. **Ask before remote/workflow state changes.** Code changes are yours to
   make; commits, pushes, PRs, later Jira transitions, and task completion are
   not. One exception: if the linked Jira ticket is still in a not-started
   status (**New**, **To Do**, or **Open**), move it to **In Progress** when
   implementation starts (launching implement is the consent). Idempotent
   DevHub metadata updates (tags, links, note context) are normal bookkeeping
   and do not need a separate confirmation.
2. **The diff is the deliverable.** Minimal, boring, verified.
3. **Resume, don't duplicate.** Reuse existing branches, PRs, links, tags, and
   note sections when a previous run already created them.
4. **Review before handoff.** Verification proves the checks pass; a structured
   local-diff review — persisted as a real note linked to the repo, not just a
   line in the task note — proves the change is understandable, scoped, and
   actually fits the task before asking to commit it.

## 0. Fetch the plan

The launch prompt gives you a **plan URL**. Curl it first:

```bash
curl -sf '<plan-url>'
```

It returns JSON: `id`, `date`, `text`, `done`, `tags`, `jiraKey`, `jira`
(summary + status), `notePath`, `links` (EntityRefs), and `repos` (candidate
repos from task links).

If more than one repo is listed and the notes don't disambiguate, ask the
user which repo to work in **before** writing any code.

## 1. Gather context (DevHub MCP)

With the plan in hand, pull the surrounding context via the notes MCP:

- `notes_read` the task note at `notePath` (if it exists) - it may hold a
  plan, decisions, or prior attempts.
- Run `entity_links_read` on the task note, then read every directly linked
  note/repo/PR resource. A linked
  implementation-plan note is required reading; a PR link means review its
  state first.
- If `jiraKey` is set and the plan's Jira summary is thin,
  `jira_ticket_get` it; read acceptance criteria carefully.
- When the topic is unfamiliar, a quick `recall` query on the task text
  surfaces prior sessions and learnings.
- Check existing PR links and the current branch before starting. If work or
  a PR already exists, resume it instead of creating parallel work.
- Fetch the target repo before choosing a base. Resolve the intended remote
  base from an existing PR or the repo default branch. If a prerequisite PR has
  merged, start from its merge commit on the updated remote base, not the old
  pre-merge feature commit. If implementation work already exists on that old
  commit, preserve the work and rebase/re-anchor it onto the current remote
  base before verification or push.

Do not skip this because the task text looks self-explanatory. The list item
is the headline, not the spec.

Before editing, write a short acceptance checklist from the task, Jira, and
notes. If those sources conflict or leave a product decision open, ask once
and resolve it before coding.

## 1.5 Start-of-work Jira status

If `jiraKey` is set, check the ticket status from the plan payload or
`jira_ticket_get`. Treat these as not-started (case-insensitive exact match on
the status name): **New**, **To Do**, **Open**.

When the status is one of those:

1. Call `jira_ticket_transition` without `transitionId` to list options.
2. Pick the transition whose name targets **In Progress** (prefer an exact
   name match; accept common variants like "Start Progress" that land in In
   Progress).
3. Apply it with `confirm: true`.
4. Tell the user in one short line that the ticket moved
   `<prior status>` → In Progress.

Skip if there is no `jiraKey`, the status is already In Progress (or further
along), or no In Progress transition is available — note that and continue.
Do not ask for this one; do not reverse it if implementation later stalls.

## 2. Normalize and propagate tags

Treat tags as durable context, not decoration:

1. Start with every `#tag` already on the task and linked notes.
2. Call `tags_list` before adding anything. Reuse an existing canonical tag
   instead of creating a near-duplicate.
3. If the task has no useful tags, add 1-3 stable domain/workstream tags from
   the ticket and notes. Do not create one-off ticket IDs, statuses, person
   names, `#pr`, or `#todo` tags.
4. Add missing canonical tags with `tasks_context_sync` (it dedups against
   existing tags and merges the task + canonical task-note context in one
   server-side operation). Update other linked implementation notes
   separately after reading them; preserve their content and avoid duplicate
   tokens.
5. Run `tags_lookup` for every canonical tag, then read the highest-relevance
   related resources returned. One bounded pass is enough; do not recursively
   crawl the whole graph.

Tags are inline `#tokens`; adding a normalized token to task/note text creates
the tag. Before writing a note, read it first. Use a single `Tags: #one #two`
line (or the note's existing tags line) and preserve all existing content.

## 3. Implement

In the target repo:

- Use `repos_list` to resolve the linked repo to its local path. Check repo
  status before editing and preserve unrelated dirty work.
- Confirm the implementation branch's merge base is the intended current
  remote base. A branch may stack on an open prerequisite PR, but once that PR
  merges it must be re-anchored to the updated base before it is pushed.
- Understand the relevant code first (entry points, conventions, existing
  utilities). Reuse before you add.
- **Minimal diffs.** Smallest change that does the job. No speculative
  abstractions, no "while we're here" refactors, no drive-by formatting.
- **No unnecessary comments.** Comments explain _why_, never _what_. If code
  needs a comment to be understood, rewrite the code instead. Specifically
  banned: narration comments ("// call the API"), section banners,
  changelog/restates-the-diff comments, commented-out code. Only comment
  when there's a non-obvious constraint a future reader genuinely can't see.
- Match existing style and patterns over your personal preferences.
- Never copy credentials, tokens, private connection strings, or raw customer
  data into task text, tags, notes, commits, or PRs.

## 4. Verify gate

Run the repo's own checks (lint, typecheck, tests - check package.json /
Makefile / CI config for what they are). **All must pass before you offer any
post-implementation step.** If they fail, fix or report - do not offer a PR
on a red baseline. Check the final diff for unrelated changes and record the
exact verification commands/results in the task note summary.

## 4.5 Pre-commit review gate

Before offering commit/push, invoke the `pr-explain-review` skill in local-diff
mode against the exact implementation branch and intended remote base. This is
mandatory even when no GitHub PR exists yet, and it runs **before** step 5.1 —
the review has to exist before you ask permission to commit, not after.

The review must be shown to the user and **written as a real note** — see
`pr-explain-review`'s local pre-PR mode: path `pr-reviews/<repo>-<branch>`,
with a `## Links` section that always carries an explicit **Repo:** backlink
(the local clone folder name) plus the **Task:** backlink. A `noteSummary`
blob on the task note is not a substitute; the task links to the note, it
doesn't carry the note's content. A two-line implementation recap is not a
review either way. Include:

- task/Jira fit and the resolved base branch/commit;
- changed-file implementation map and diff size;
- real entry points and an entry-to-exit control-flow walkthrough;
- correctness, security, accessibility, performance, and regression findings;
- complexity/ponytail deletion pass, including concrete locations and a net
  line estimate or `Lean already. Ship.`;
- tests checked, exact command results, and manual validation still pending;
- verdict.

Fix every must-fix finding, rerun the relevant checks, and refresh the note
before offering post-implementation actions. Once a PR exists (step 5.2),
update this same note in place with the PR link and GitHub conversation
context — see step 5.4. Never create a second review note for the same
change.

## 5. Post-implementation checklist

Summarize first: what changed (files + approach) and how it's tested. Then
walk this list, **asking the user before each step** and respecting their
answer:

1. **Commit & push?** Only after the pre-commit review gate passes, propose a conventional-commit message
   (`feat:`/`fix:`/...), confirm branch naming, then commit and push. Never
   commit without an explicit yes.
2. **Create a PR?** Ask draft vs ready. Use the `create-pr` skill; keep the
   PR body factual and free of AI attribution. Pass this task's exact `id`,
   `date`, `notePath`, canonical tags, and existing links to the skill.
3. **Sync DevHub context:** after a PR exists, call `tasks_context_sync` with
   the task's exact `id`/`date`, the canonical tags, the PR EntityRef, and
   `noteSummary` keyed by the PR URL (`noteSummaryKey`). It merges tags and
   links server-side, refreshes the note's Links section, and skips a summary
   that is already present. Only fall back to manual read-merge-write
   (`tasks_update` + `notes_write`) when the tool is unavailable.
4. **Refresh the review note?** The pre-commit review gate (4.5) already wrote
   `pr-reviews/<repo>-<branch>`. Ask whether to update it in place now that the
   PR exists — add the `[<repo>#<number>](<PR url>)` line and a **PR:** entry
   in `## Links`, and fold in the GitHub conversation (comments, review
   threads) via `pr-explain-review`. Don't generate a new note.
5. **Move Jira to Code Review?** If `jiraKey` is set, list available
   transitions (`jira_ticket_transition` without a transitionId). Ask
   explicitly whether to move the ticket to **In Code Review** (or the closest
   available equivalent). Only apply with `confirm: true` after a yes. If they
   decline, do not offer alternate Jira statuses unless they ask.
6. **Mark the DevHub task done?** Ask whether to mark this DevHub task
   complete (`tasks_update` / done). Only mark it done if they say yes. This
   is separate from the Jira status — do not treat a Code Review transition as
   completing the DevHub task.
7. **Learning?** If anything notable surfaced (a gotcha, a reusable pattern),
   capture it via the notes MCP learnings tree. Skip if nothing did.

The user may stop after any step - that's fine. Their "no" is a complete
answer; do not re-ask.

## Blocked / failing path

If you cannot implement (missing context, failing baseline you can't fix,
ambiguous requirements):

- Write findings so far to the task note: what you tried, what blocked you,
  what you'd need. Read first and update the existing blocker section rather
  than appending the same report again.
- Offer the user: keep the task open with the note, or abandon with a reason.
- Do not mark anything done, do not open a PR, do not transition Jira further
  (if not-started → In Progress already ran, leave the ticket there).
