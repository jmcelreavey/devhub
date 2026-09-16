---
name: devhub-implement-task
description: Implement a DevHub task from its context through verification and requested handoff steps.
metadata:
  short-description: Implement a DevHub task end-to-end
---

# DevHub Task Implementation

## Overview

Take one DevHub task from "text in a list" to "implemented, verified, and
handed back to the human". Five rules govern everything:

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
5. **Findings are notes, code is the repo.** Everything you learn on the way —
   contracts, evidence, decisions — lands in the vault. The repo gets code and
   the rules for editing it, nothing else. See §2.5.

## 0. Fetch the plan

Optional: `tasks_implement_ready` (or `GET /api/tasks/implement/ready`) returns the light checklist (acceptance/plan, unanswered `## Open questions`, repo, open `#prerequisite`/`#blocker`). Treat misses as warnings unless the response says `blocked`.

If the plan payload says `"stage": "draft"`, the task is a captured idea, not a plan. Stop and suggest **Write plan with Agent** (the `devhub-plan-write` skill) instead of implementing — unless the user explicitly says to go ahead.

The launch prompt gives you a **plan URL**. Curl it first:

```bash
curl -sf '<plan-url>'
```

It returns JSON: `id`, `date`, `text`, `done`, `tags`, `jiraKey`, `jira`
(summary + status), `notePath`, `links` (EntityRefs), and `repos` (candidate
repos from task links).

It also returns the resolved neighbourhood, so you don't have to crawl it:

- `notes` — notes that represent or link to this task.
- `related` — the direct neighbourhood: the task's own links, **plus whatever
  links back at it**. Links are stored one-way, so a prerequisite task that
  names this one only shows up here.
- `context` — one hop further: what those links themselves link to (a related
  ticket's plan note, a linked note's ticket).

`repos` deliberately comes from the task's own links only — never pick a
checkout from something in `related`.

If more than one repo is listed and the notes don't disambiguate, ask the
user which repo to work in **before** writing any code.


## 0.5 Task↔run link and durable handoff

Every implement session must leave a resume-ready trail on the task:

**Storage / MCP contract**

| Concern | MCP | HTTP |
| --- | --- | --- |
| List / upsert linked runs | `tasks_agent_runs` | `GET/POST /api/tasks/agent-runs` |
| Read handoff | `tasks_agent_handoff_get` | `GET /api/tasks/agent-runs/handoff?taskId=` |
| Write handoff | `tasks_agent_handoff_set` | `PUT /api/tasks/agent-runs/handoff` |
| Resume (follow-up or new) | `tasks_agent_resume` | `POST /api/tasks/agent-runs/resume` |

Sidecar files live at `notes/.config/task-agent-runs/<taskId>.json` (plus `_index.json` for runId→taskId). Run `status` values: `queued` \| `running` \| `paused` \| `done` \| `failed` \| `abandoned`.

**On start (and after any `agent_dispatch` / dock run id is known)**

1. `tasks_agent_runs` with `taskId` + `runId` (+ `provider`, `status: "running"`).
2. If resuming, prefer `tasks_agent_resume` (or UI **Resume with Agent…**), which injects handoff + plan URL. Otherwise call `tasks_agent_handoff_get` **before** coding and treat the markdown as the source of truth for prior progress, branch/PR, blockers, and next steps.

**Interactive CLI (Implement / Resume / Continue in the terminal dock)**

When the prompt includes a DevHub Agent Activity run id (injected by the UI):

1. After your first meaningful progress update, call `agent_interactive_note` with that `runId` and a short status.
2. When you finish (success or stop), call `agent_interactive_finish` with `runId`, `ok`, your `sessionId`, and a short `resultText` (or `error`). DevHub closes the run itself when the CLI exits or the tab closes, but only this call records the session so the task can be continued later.

**Before pause, end-of-day, or abandon**

1. Write/update handoff via `tasks_agent_handoff_set` (use `mode: "append"` only for additive checkpoints; prefer a full replace that stays current).
2. Include at least: what changed, branch/PR/session if any, verify status, open questions, and the exact next action.
3. Set the linked run to `paused` (EOD/pause) or `abandoned` (giving up) via `tasks_agent_runs`.

Do not rely on chat scrollback alone — the handoff is what the next session reads first.

When any linked run ends, DevHub appends a `### Run <runId>` snapshot to the handoff (branch, last commit, changes vs base, uncommitted files, session). Write your own notes above it; don't repeat what the snapshot already says.

**After the PR exists** DevHub watches it (`tasks_pr_watch`, every 10 minutes): failing CI, requested changes or new comments show on the task as **Fix PR with Agent**, and a merge offers **Complete task**. When you are resumed for a PR finding, the prompt starts with `FIX THE PULL REQUEST FIRST` — read the full failure with `gh pr checks` / `gh pr view --comments`, fix it on the same branch, and ask before pushing.

## 1. Gather context (DevHub MCP)

With the plan in hand, pull the surrounding context via the notes MCP:

- `notes_read` the task note at `notePath` (if it exists) - it may hold a
  plan, decisions, or prior attempts.
- Read every `note` in `related` — a linked implementation-plan note is
  required reading, and a PR link means review its state first.
- Skim `context` for anything that changes the approach: a prerequisite task's
  PR state, a related ticket's plan note. Read the ones that do; ignore the
  rest. The plan already walked this graph — don't re-walk it.
- Use `entity_links_resolve` only for something the plan didn't cover (a repo
  or ticket you reached some other way). It reads both directions too.
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

## 2.5 Where prose goes

Investigation produces writing — a service contract you reverse-engineered,
probe results, an ownership trail, a decision record. **That output is a DevHub
note, never a file in the target repo.** Default to
`discovery/<TICKET>-<short-slug>`, matching the vault's existing
`discovery/PTF-xxxx-*` notes, with a `## Links` section carrying **Jira**,
**Repo**, and **Task** entries plus the canonical tags — otherwise the ticket
and the task have no way to find it.

The repo gets only what a future editor of *that code* must not break, in the
form the repo already uses for it:

| Output | Home |
| --- | --- |
| Contract discovery, probe evidence, ownership, decisions, open questions | note: `discovery/<TICKET>-<slug>` |
| Rules the next person editing this directory must follow | the narrowest `AGENTS.md` in that subtree |
| How *this repo* is wired, for every reader of the repo | `docs/` — only if the repo already keeps that kind of page there |
| Reusable gotcha worth surfacing beyond this ticket | `learnings/` note (step 7) |

A repo's `docs/` tree is a trap when it already holds pages about external
services: those describe how this repo talks to them, and yours will
pattern-match right into the set. Two tests — if the page goes stale the moment
the ticket ships, or means nothing to someone who never saw the ticket, it is a
note, not a doc.

Never let a question decide this for you. When `AskUserQuestion` offers a scope
choice, keep artifact locations out of the option text: the user is answering
"how much work", not ratifying a path, and a path buried in an option reads as
approved when it was never considered. Settle the destination from the table
above before asking, then state it as a fact when you report back.

## 3. Implement

In the target repo:

- Use `repos_list` to resolve the linked repo to its local path. Check repo
  status before editing and preserve unrelated dirty work.
- Confirm the implementation branch's merge base is the intended current
  remote base. A branch may stack on an open prerequisite PR, but once that PR
  merges it must be re-anchored to the updated base before it is pushed.
- Understand the relevant code first (entry points, conventions, existing
  utilities). Reuse before you add.
- **Touching dashboard UI? Read `docs/reference/ui-vocabulary.md` first.** It
  lists the components, CSS primitives, hooks and server helpers that already
  exist. One read is far cheaper than the greps it replaces, and it is the
  difference between reusing `tone-panel--warning-banner` and inventing a
  second warning style that looks almost the same.
- **Never call `execFile`/`spawn` directly** — use `execExternal`
  (`lib/exec-external.ts`). It applies a mandatory timeout and registers the
  call for `/api/status/exec`. An un-timed subprocess blocks every route.
- **Minimal diffs.** Smallest change that does the job. No speculative
  abstractions, no "while we're here" refactors, no drive-by formatting.
- **No unnecessary comments.** Comments explain _why_, never _what_. If code
  needs a comment to be understood, rewrite the code instead. Specifically
  banned: narration comments ("// call the API"), section banners,
  changelog/restates-the-diff comments, commented-out code. Only comment
  when there's a non-obvious constraint a future reader genuinely can't see.
- Match existing style and patterns over your personal preferences.
- Local upstarts and other long-running processes go through DevHub MCP `terminal_propose_run` (`kind: "upstart"`, distinct `label`) so logs are visible in the dock, in their own tab. Do not background them in the agent shell.
- Never copy credentials, tokens, private connection strings, or raw customer
  data into task text, tags, notes, commits, or PRs.

## 4. Verify gate

Run the repo's own checks (lint, typecheck, tests - check package.json /
Makefile / CI config for what they are). **All must pass before you offer any
post-implementation step.** If they fail, fix or report - do not offer a PR
on a red baseline. Check the final diff for unrelated changes and record the
exact verification commands/results in the task note summary.

If the target is the DevHub dashboard UI, load `devhub-dashboard-verify` before
opening a browser. **localhost:1337 is the packaged production app**, not
webpack — do not test checkout changes there.

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

**Then open the review beside the code.** Once the note is final, call
`notes_cursor_open` with that note path and the local repo name (the same
"Open with Cursor" action the dashboard's note rows use). It puts a Markdown
working copy of the review in Cursor next to the checkout, so the review and
the diff are readable together — which is the point of asking for a commit
decision at all. Do this **before** the step 5.1 question, not after, and
mention it in one short line when you ask.

Use `notes_cursor_open`, not `prs_open_in_cursor`, at this stage: the branch is
already checked out with uncommitted work, and `prs_open_in_cursor` stashes and
re-checks-out. It is the right call only later, when reviewing an existing PR
from a clean tree. If the user edits the working copy, `notes_cursor_apply`
brings their edits back into the note.

## 5. Post-implementation checklist

Summarize first: what changed (files + approach) and how it's tested. Then
walk this list, **asking the user before each step** and respecting their
answer:

1. **Commit & push?** Only after the pre-commit review gate passes and its note
   is open in Cursor (§4.5), propose a conventional-commit message
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
