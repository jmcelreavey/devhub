# Pre-commit review gate: assigned reviewer and Cursor

Read from `devhub-implement-task` §4.5 when the plan payload names a `reviewer`, or before opening the review in Cursor.

**Assigned reviewer.** The plan payload's `reviewer` is `null` (you review your
own diff, as above) or `{ provider, model }`: an assistant the user chose to
review before you commit. When it is set, that assistant writes the
review and you act on it:

1. Choose the note path `pr-reviews/<repo>-<branch>`, as above.
2. Call `tasks_implement_review` with the task `id` and `date`, `cwd` (this
   checkout or worktree, `pwd` is enough), `notePath`, `branch` and `base`. It
   starts the reviewer read-only. Don't use `agent_dispatch` for this: the
   nesting guard refuses it.
3. Note `git status --short` first, then `agent_wait` on the returned run id and
   `notes_read` the note. If the run failed or the note is missing,
   `agent_output` shows why.
4. The reviewer must not have touched the tree. If `git status --short` changed,
   stop and tell the user what moved; don't carry on.
5. Fix every must-fix finding and rerun the relevant checks. Then update that
   same note in place with a `## Resolution` section: what you changed for each
   finding, and anything you disagreed with and why. Never write a second note.
6. Post an `agent_interactive_note` that names the reviewer, for example
   "Reviewed by codex / gpt-6-astra: 2 must-fix, both addressed."

If `tasks_implement_review` errors (provider not ready, Paseo down, no reviewer
assigned any more), say so in one line, review the diff yourself as above, and
write in the note that the assigned reviewer didn't run. Never skip the review
quietly.

**Then open the review beside the code.** Once the note is final, call
`notes_cursor_open` with that note path and the local repo name (the same
"Open with Cursor" action the dashboard's note rows use). It puts a Markdown
working copy of the review in Cursor next to the checkout, so the review and
the diff are readable together. Do this **before** step 5.1, not after, and
mention it in one short line in your summary.

**If you worked in a worktree, say so.** `notes_cursor_open` opens the repo's
main checkout unless you pass `worktree`. An agent run works on its own branch
under the repo's git dir, so without it Cursor shows the review next to code
that does not contain the change — the one thing this step exists to prevent.
Pass the worktree's branch or absolute path (`pwd` is enough; `agent_runs`
reports it too). Say which folder opened, not just that Cursor opened.

Use `notes_cursor_open`, not `prs_open_in_cursor`, at this stage: the branch is
already checked out with uncommitted work, and `prs_open_in_cursor` stashes and
re-checks-out. It is the right call only later, when reviewing an existing PR
from a clean tree. If the user edits the working copy, `notes_cursor_apply`
brings their edits back into the note.
