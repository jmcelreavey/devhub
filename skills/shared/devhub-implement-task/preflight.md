# Implementation preflight and recovery

Read this before planning or implementing a DevHub task. Reuse the task's
handoff when resuming; validate its recorded facts before repeating setup.

## Repositories

1. Use `repos_list` to find the target and any reference repos. Check the
   configured repos folder before cloning. Clone a missing repo from the same
   git organisation with `repos_clone` into that folder, never a temporary
   clone per stage. Verify its remote matches the repo you need.
2. Before investigation, fetch the relevant remote once and resolve its actual
   default branch. Use the existing PR base when the task already has a PR.
   Record the remote, base SHA and fetch time so later stages can reuse them.
   Refresh when resuming a later session, when a prerequisite merges, or when
   changed remote state matters; do not pull again merely because a stage changed.
3. For a reference checkout, check status, worktrees, active agent runs and dock
   terminals first. Only switch to the remote default branch and
   `git pull --ff-only` when the checkout is clean and unused. A clean working
   tree alone does not prove it is unused. If busy, dirty, diverged or uncertain,
   inspect the fetched remote ref with read-only git commands or use a separate
   worktree at that ref. Preserve local commits and never stash, reset or stop
   another task's service to make inspection easier.
4. When the user disables the isolated worktree for a new implementation,
   DevHub saves tracked and untracked changes in a named stash, switches to the
   remote default branch (normally `main`) and fast-forwards it before launch.
   Read the preparation receipt and preserve that stash for the previous work;
   do not pop or drop it. Stop on a busy checkout, an unfinished Git operation,
   a failed fetch or a diverged base. Resume, review and fix stages keep their
   existing task branch and edits; they must not repeat this preparation.
5. Keep the implementation on its task branch in the selected checkout.
   Create a branch only when one was not already supplied. Reference repos are
   for reading; source edits, commits and pushes stay in the task's repo.

## Environment

Only start an environment when implementation or verification needs it.

1. Check `terminal_list` and the handoff for an existing environment. Confirm
   its checkout, port, readiness and, for native apps, installed binary and
   native inputs. Reuse a healthy matching service. A listening port alone
   does not establish that it serves the task's code.
2. Load `devhub-repo-upstart`. Use the stored
   `upstarts/<repo>/upstart.sh` in DevHub's private store. If missing, create
   it there from the repo's documented commands. Repair repeatable dependency,
   configuration or startup failures in that script, then verify the script
   itself. Honour lockfiles and the repo's package manager; keep secrets out
   of scripts, notes and logs.
3. Start the stored upstart from the selected checkout through
   `terminal_propose_run` with `kind: "upstart"` and a useful label. Inspect
   `terminal_proposal_status` and `terminal_tail` until the app is ready.
   Preserve other running services; choose a free port when needed.
4. For browser QA, check that the task preview URL serves this checkout, or
   configure `upstarts/<repo>/preview.json` using DevHub's existing preview
   schema and a command that invokes the stored upstart. Start preparation
   must respect the assigned preview port: pass `{port}` through an explicit,
   validated upstart argument such as `--port`, rather than relying on inherited
   `PORT` (upstarts clear DevHub's inherited port). Do not invent preview configuration
   keys or treat a Metro endpoint as a browser-rendered native app.
5. Save the checkout, branch/base SHA, upstart path, terminal session, URL/port
   and readiness check in the task handoff. Subsequent stages validate and
   reuse this environment. Keep the server in the dock while the task needs it.

Planning normally needs only the repository checks. Start an environment
during planning only when reproduction or a concrete design question needs it.

## Finish and free disk space

- Before publishing, keep the handoff, review notes and useful screenshots in
  DevHub's task note or media store, outside disposable worktrees. Keep the
  branch, commit SHA, PR URL and exact verification results.
- Auto owns cleanup after the PR's review and QA have finished. Opening the
  draft PR is too early: review and fix rounds still need the checkout.
  Stop only task-owned previews or upstarts once their checks are complete.
- After each finite terminal command, capture its result and session id, then
  check that its tab closed. Close finished task-owned tabs, including failed
  attempts after saving the useful output. At handoff, check `terminal_list`
  for leftovers; stop and close task-owned services no longer needed. Preserve
  other tasks' terminals and services the user asked to keep running.
- Cleanup verifies the current commit is published and checks active runs,
  processes and terminals. It keeps branches, uncommitted source, untracked
  files, secrets and unknown ignored files. When those prevent removing the
  worktree, trim only recognised regenerable builds.
- Include dependency folders, custom Next build directories, native build
  output and Xcode DerivedData owned by this checkout. Never clear all shared
  caches or simulator data as a routine implementation step.
- A later fix restores the saved branch and uses the stored upstart to rebuild
  only what is missing. Report a cleanup blocker in the handoff; the scheduled
  sweep retries after the checkout is no longer in use.

## Recovery checkpoint

When a meaningful blocker or workaround occurred, finish the checkpoint in
the current run before handing off. Skip it for routine successful work.

- Record the symptom, confirmed cause (or say unknown), successful recovery,
  applicability and verification in the task note. Include failed approaches
  worth avoiding, so the next stage does not repeat them.
- Prefer a small fix at the source: the stored upstart, task code, or existing
  configuration within the authorised scope. Verify it through the normal
  entrypoint. Keep unrelated product fixes as follow-ups in the task note.
- For a reusable lesson, search `recall` first and update the existing DevHub
  learning note, or create one through the notes MCP with a repo backlink.
  Link it from the task handoff. Put a concise repo editing invariant in the
  narrowest applicable `AGENTS.md` only when it belongs there.
- Label the outcome **fixed at source**, **workaround documented**, or
  **follow-up needed**. A workaround is not a permanent fix. Record any
  credentials or external action still needed without storing secret values.
- Before setup on the next run, read the handoff and use a scoped `recall`
  query for the repo and setup problem. Confirm the advice still applies to
  the current version before following it.

For failed UI automation, record the tool, scenario and failure. Try another
method only when there is a concrete reason it can work. If blocked, retain
the exact manual check and continue independent work; repeated identical
screenshots do not increase coverage.
