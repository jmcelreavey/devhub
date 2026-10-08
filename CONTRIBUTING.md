# Contributing to DevHub

DevHub is distributed as a **personal private mirror** of a shared public core. You run
your own copy with your own notes, tasks, persona, and (optionally) private plugins, while
pulling core improvements and contributing generic features back.

See [`docs/architecture/plugins.md`](docs/architecture/plugins.md) for the plugin design and
[`docs/contributing/creating-plugins.md`](docs/contributing/creating-plugins.md) for building one.

## Repo topology

- **Public `devhub`** — the shared core. Generic features only. No company-specific or
  personal content.
- **Your private mirror** — your working copy. Full history, your notes/tasks committed
  here, your private plugins wired in. Has the public core as `upstream`.
- **Plugins** — separate repos (one per plugin). Company/private plugins stay private;
  community plugins are public.

## First-time setup (private mirror)

```bash
# 1. Create your private repo
gh repo create <you>/devhub --private

# 2. Mirror the public core into it
git clone --bare https://github.com/<owner>/devhub.git
cd devhub.git
git push --mirror https://github.com/<you>/devhub.git
cd .. && rm -rf devhub.git

# 3. Clone your private repo and add the core as upstream
git clone https://github.com/<you>/devhub.git
cd devhub
git remote add upstream https://github.com/<owner>/devhub.git
```

## Pulling core updates

Existing private mirrors may have an **unrelated history** to the public core, which
was seeded from a clean tree to keep private history out. `devhub-update.sh` ports
the _content diff_ of new upstream commits onto your mirror via `git apply --3way`, and
tracks the last-pulled commit in the git ref `refs/devhub/upstream-sync`.

**From the dashboard:** the **Actions** page has **Pull Core Updates (Preview)** (read-only —
shows incoming commits) and **Pull Core Updates** (applies + validates + re-syncs). Your
live-dirty personal files don't block it. This is the easiest path; the CLI below is the
same thing.

```bash
# First run only: tell it where your mirror last matched public (e.g. the initial commit).
scripts/devhub-update.sh --since <upstream-ref>

# After that, the marker is automatic:
scripts/devhub-update.sh            # apply new upstream changes, re-sync, validate
scripts/devhub-update.sh --dry-run  # preview incoming changes only
```

After you **backport** a feature (below), your mirror already contains everything public
has, so don't re-pull it — just advance the marker:

```bash
scripts/devhub-update.sh --mark-synced
```

## Contributing a feature back

Only **generic** features belong in core. Company/personal/private things stay in your
mirror or a private plugin.

```bash
scripts/devhub-backport.sh <feature-branch>
```

The backport flow **branches off the upstream default branch and applies a content patch**.
It excludes personal data and plugin content, scans added lines, and creates a local preview
commit. Add `--execute` to push the branch and open a PR against the public core, or use
`--patch-only` to inspect the patch without switching branches. To open a PR manually:

```bash
gh pr create --repo <owner>/devhub --base main
```

Before opening a PR:

- `npm run verify` from the repo root must pass (MCP types, dashboard checks and build).
- Confirm the diff contains no personal data, secrets, or private-plugin content.

## Developing a feature as a plugin

New features can incubate as a plugin (own repo or a folder under
`~/dev/devhub-plugins/<name>`) and graduate into core once proven and generic. See
[Creating a plugin](docs/contributing/creating-plugins.md).

## Personal-data boundary

These paths hold **per-developer** data. They live committed in your private mirror and
must **not** be contributed to the public core. The public repo ships placeholders or
generic defaults for these paths:

| Path                   | What                                           | Relocate via      |
| ---------------------- | ---------------------------------------------- | ----------------- |
| `notes/`               | Notes, daily logs, learnings                   | `NOTES_DIR`       |
| `diagrams/`            | Personal root diagrams                        | Content root     |
| `tasks/`               | One JSON file per task (`items/`), plus import leftovers | `TASKS_DIR`       |
| `reps/`                | Daily review-rep JSON (`YYYY-MM-DD.json`)      | `REPS_DIR`        |
| `collections/`         | Checklist collections                          | `COLLECTIONS_DIR` |
| `upstarts/`            | Per-repo Upstart scripts (`<repo>/upstart.sh`) | `UPSTARTS_DIR`    |
| `persona/identity.txt` | Your voice/tone                                | —                 |
| `skills/shared/my-voice/{writing-style,learned-voice}.md` | Your writing samples and learned voice rules | — |
| `dashboard/.env.local` | Secrets/config                                 | — (git-ignored)   |

Set the env vars to point these at a separate (e.g. private) location to keep personal
data out of the repo tree entirely. Defaults stay `REPO_ROOT/<dir>` for back-compat.

The backport workflow branches off `upstream/main` and applies only public code and
catalogue changes as content patches. Public and private histories stay separate.
Review the patch and run the leak scan before publishing; path exclusions cannot
recognise personal content copied into a code file.

Company workflows belong in a separate plugin repo. See the
[fork workflow](docs/contributing/fork-workflow.md) and
[plugin guide](docs/contributing/creating-plugins.md).

## Code standards

- TypeScript, no `any`; `interface` for object shapes, early returns, `const` by default.
- Conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
- Keep PRs small and single-concern.
- No secrets, ever. No company-internal names in the public core.

## Traps

Things that have cost real time here. Each one looked like it worked and didn't.

### Never edit plugin-overlay files from this repo

Files contributed through a plugin's `dashboard.paths` are **materialised from that
plugin repo** and listed in `.git/info/exclude`. In core they are untracked, invisible
to `git status`, and **overwritten by `sync_plugins`, which `prebuild` and `prestart`
run automatically**.

An edit here looks like it worked, passes typecheck, then silently vanishes at the
next build. Edit the source in the plugin repo, then re-run `sync_plugins`.

### Verify against the source, not the materialised copy

Related and worse: a codemod that rewrites both the core tree _and_ the materialised
copies will make `tsc` pass while the plugin **source** is still broken. The green
typecheck proves nothing — it's checking generated output.

After any change that touches shared components or imports, update each affected
plugin, run `sync_plugins`, and **build again**.

### Verify the checkout you're running

The packaged desktop app usually owns port 1337. Checkout edits won't appear there.
Check the listening process before debugging the code:

```sh
lsof -nP -iTCP:1337 -sTCP:LISTEN
```

Run checkout verification on a free port with `DEVHUB_SCHEDULER=0` and a separate
`DEVHUB_DIST_DIR`; keep the packaged app running. See the [dashboard verification skill](skills/shared/devhub-dashboard-verify/SKILL.md).

### React 19.2.4 has no `ViewTransition`

Do not re-enable `experimental.viewTransition`. React stable exports no
`ViewTransition` component, so the React half is a no-op while Next's
`document.startViewTransition` throws `InvalidStateError` every ~30s. An e2e spec
fails if the flag comes back. Revisit only when React ships it in a stable release.

### Shell scripts run under macOS bash 3.2

- No `mapfile` / `readarray` — use a `while read` loop.
- BSD `sed -i` needs an extension argument (`sed -i ''`), and silently no-ops without
  one. Prefer Python for in-place edits.
- `set -o pipefail` plus `| head` kills the script via SIGPIPE. Use `-n 1` on the
  producer instead.

### Vitest 4 removed `environmentMatchGlobs`

It fails silently — jsdom never loads and `environment` shows `0ms`. Use a per-file
docblock instead:

```ts
/** @vitest-environment jsdom */
```

### Notifications that always fire get ignored

Repo health first warned on most repos, mostly for "no activity in N days".
Dormant checkouts are normal. If a signal appears on
most rows it is decoration, not triage — split what's genuinely actionable from
what's merely true, and let silence mean "fine".
