---
title: Repo conventions
description: Learn and assess repo conventions automatically from PR feedback and guidance, then use them in reviews and new PRs.
order: 12
icon: BookOpen
tags: [workflow, github, agents]
related:
  - guides/auto-pr-review
  - architecture/recall
  - architecture/mcp-server
  - reference/api-routes
---

# Repo conventions

Every repo has rules nobody wrote down. "Our pattern is one file per handler." "Config lives under `stripe.origin`, not a new env var." You only find out when someone leaves it as a review comment, and the next PR hits the same thing.

Conventions reads those comments (plus the repo's own `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` and Copilot instructions), asks a model to pull out the durable rules, and keeps them per repo. The same model decides which rules to accept or reject and records its reason. Agents that review a PR or open one use the active rules.

It lives at `/conventions` (⌘P → Conventions). Right-click a repo on **Repos → Conventions** to jump straight to it. Repo cards show how many rules are active. There is no approval queue.

It only ever runs on demand. Having access to hundreds of repos costs nothing: a repo is first mined when someone starts a review or opens a PR in it, and never before.

## How a rule is made

1. One GraphQL call pulls the last N PRs (30 by default) with their review threads, review bodies and conversation comments.
2. A filter keeps comments from team members only (`OWNER`, `MEMBER`, `COLLABORATOR`). Bots, the PR author's own replies, drive-by accounts, "LGTM" and one-word replies are dropped. What's left is scored: convention language ("our pattern", "we usually", "instead of") and comments the author acted on score highest. Resolution alone does not prove that the code changed.
3. A comment has **evidence of author agreement** when GitHub marks its thread outdated and the PR author either resolved the thread themselves or left a short completion reply such as "done" or "fixed" after the comment. A reply disagreeing with the reviewer does not count. Neither signal alone counts, and this remains a heuristic rather than a diff-level proof. A resolved thread can be a question answered with "no", and an outdated one can be a rebase.
4. The model gets the numbered comments (with that flag), the guidance docs and the rules you already have. It returns rules citing comments by number. It never writes a URL or a quote, so a rule can't point at a comment that doesn't exist, and a rule that cites nothing real is dropped.
5. Each candidate includes **accepted** or **rejected** and a short reason. Supported, durable expectations become active immediately. One-off fixes, conflicting feedback, personal preference and unclear evidence are rejected. Author agreement supports a decision; it does not make a rule valid on its own. Repeats add evidence instead of creating duplicates.

Runs are incremental. A PR is read again when substantive feedback is added or edited, or its thread state changes, so for a repo that's just being reviewed, a run is one GraphQL call and usually no model call.

## Which rules are in force

Only **accepted** rules reach agents and Recall. **Active** is the default view. Each automatic decision shows its reason and links back to the evidence. **Rejected** keeps the candidates the model declined, as well as rules you removed.

You don't need to approve anything. **Remove** takes an active rule out of use; **Reinstate** activates a rejected rule immediately. Both are human overrides, so later mining won't reverse them. Editing the wording also keeps your version. Only rules you added yourself can be deleted outright.

Automatic decisions can change when new feedback or changed guidance provides a reason to reconsider them. A human removal stays removed. Existing suggestions from the old approval flow are assessed automatically the next time that repo is used or viewed; they remain out of agent context until the assessment succeeds. Existing human decisions are preserved.

**Undo last decision** restores the previous status and automatic decision reason. It remains available until another decision or you leave the repo. It cannot undo wording edits or deletion, and it refuses to overwrite a rule changed since the decision.

The same provider and model handle extraction and decisions in one call. There is no second model call just for approval.

## When it runs

All of these go through one check that skips the run when the repo was mined recently (12 hours by default), GitHub isn't signed in, or the feature is off. Even when it does run, the model is only called if there's review feedback it hasn't read: unchanged feedback and guidance skip the model call unless existing suggestions still need assessment. Each check fetches the feedback and up to four guidance files.

| Trigger | What happens |
| --- | --- |
| **Refresh from PRs** | Always runs. **Rescan all** re-reads every recent PR, not just changed ones. |
| Review with agent (PR row) | Starts a refresh for that repo in the background. |
| Auto-review | Waits up to 90s for the repo's first run, since nobody is watching, then starts the review. |
| Create-PR agent | Starts a refresh in the background. |
| An agent calls `repo_conventions` | Starts a run when due, including automatic assessment of existing suggestions. |
| Viewing a repo with existing suggestions | Starts their automatic assessment, with the usual failure backoff. |

There is no background sweep. A repo you never review in or open a PR for is never touched.

A failed run is retried after an hour, not the full interval, and never costs you your reviewed rules.

## What agents do with it

`repo_conventions` (MCP) returns the active rules as Markdown. The `pr-explain-review`, `create-pr` and `devhub-implement-task` skills call it:

- Reviews check the diff against it and add a **Conventions** section to the note.
- Create-PR lists the likely review comments before opening, and fixes the cheap ones.
- Implementation follows the rules while it writes.

Active rules are also indexed in [Recall](../architecture/recall.md) as one learning per repo, so a plain `recall` or search about the repo finds them too.

The text came from comments anyone with repo access could write, and it ends up in an agent's context. Three things limit that: only team members' comments count, rule text containing links, shell commands or "ignore previous instructions" is rejected, and the Markdown agents get says plainly that the rules are things to check code against, not instructions.

## From an agent

Everything on the page has a tool, all under the `repos` toolset:

| Tool | Does |
| --- | --- |
| `repo_conventions` | The rules in force, as Markdown, for a repo. Starts a run if it has none. |
| `conventions_list` | Repos with active and rejected counts; with a repo, every rule, reason and evidence. Optional `status: "accepted" \| "rejected"` filters the list. |
| `conventions_mine` | Refresh now (`force` re-reads every recent PR). Runs in the background. |
| `conventions_review` | `accept`, `reject`, `restore` (reinstate as active), `edit`, `add`, `delete` on a rule. Accept/reject/restore return an `undoToken`; pass it with `action: "undo"` to restore the previous status if the rule has not changed. Delete needs `confirm: true` and only works on rules you added. |
| `conventions_settings` | Read the settings, or change any of them. |

They take `owner/repo` or the local folder name.

## Settings

Under **Settings** on the page, or `conventions_settings`:

- **Mine automatically** turns off everything in the table above except Refresh.
- **PRs to read per run** and the **minimum gap between automatic runs**.
- **Provider** and **Model.** Blank follows **Setup → AI Provider** and that provider's model. This reads a lot of review text and writes rules agents will follow, so it's worth pointing at a stronger model than your everyday default. The override applies to this feature only.

Stored in `notes/.config/conventions-prefs.json`.

## Where it's stored

One file per repo at `notes/.config/conventions/<owner>__<repo>.json`: rules, the evidence behind each, which PRs have been read, and the last ten runs (when, how many PRs and comments, what was added, which provider and model, how long, and the error if it failed). The page shows the path under each repo, and `conventions_list` returns it. A repo only gets a file once something real happens: a rule is mined, a run fails on a repo that has feedback worth reading, or you press Refresh. Merely asking about a repo, or an automatic check that finds nothing, writes nothing.

It's the same idea as upstart scripts: per-repo files in your private mirror, committed, so `git log` is the history of every rule, and relocated by an env var. The difference is the directory. Upstarts have a top-level `upstarts/` and `UPSTARTS_DIR`; conventions sit inside the notes vault, so they follow `NOTES_DIR`, the installed app's data folder, migration and the content-sync button without any of that being wired up a second time. It's under a dot-directory so it stays out of the notes tree. It's private-mirror data. Don't back-port it to the public template.

## Limits

- Review comments only count if they're substantive. A convention only ever said in a Slack thread isn't here.
- Automatic assessment can misread a reviewer's preference as a convention. The recorded reason and evidence make that inspectable; Remove overrides it.
- GitHub only, through `gh`. A repo whose clone has no GitHub remote won't show up until you pass `owner/repo`.
