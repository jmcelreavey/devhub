# Contributing to DevHub

DevHub is distributed as a **personal private mirror** of a shared public core. You run
your own copy with your own notes, tasks, persona, and (optionally) private plugins, while
pulling core improvements and contributing generic features back.

See [`docs/architecture/plugins.md`](docs/architecture/plugins.md) for the plugin design and
[`docs/guides/creating-plugins.md`](docs/guides/creating-plugins.md) for building one.

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

The public core has an **unrelated history** (it's seeded from a clean tree so private
history never leaks), so you can't rebase/merge onto it. `devhub-update.sh` instead ports
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

The backport flow **branches off `upstream/main` and cherry-picks feature files only** —
it must never include your notes, tasks, `.env.local`, or plugin content. Then it opens a
PR against the public core:

```bash
gh pr create --repo <owner>/devhub --base main
```

Before opening a PR:

- `cd dashboard && npm run verify` (lint + typecheck + test + build) must pass.
- Confirm the diff contains no personal data, secrets, or private-plugin content.

## Developing a feature as a plugin

New features can incubate as a plugin (own repo or a folder under
`~/dev/devhub-plugins/<name>`) and graduate into core once proven and generic. See the
"Feature-as-plugin workflow" section of the plan.

## Personal-data boundary

These paths hold **per-developer** data. They live committed in your private mirror and
must **not** be contributed to the public core (the public repo ships them empty — just a
`.gitkeep` and, where useful, an `EXAMPLE`):

| Path                   | What                                           | Relocate via      |
| ---------------------- | ---------------------------------------------- | ----------------- |
| `notes/`               | Notes, daily logs, learnings                   | `NOTES_DIR`       |
| `tasks/`               | Daily task lists                               | `TASKS_DIR`       |
| `collections/`         | Checklist collections                          | `COLLECTIONS_DIR` |
| `upstarts/`            | Per-repo Upstart scripts (`<repo>/upstart.sh`) | `UPSTARTS_DIR`    |
| `persona/identity.txt` | Your voice/tone                                | —                 |
| `dashboard/.env.local` | Secrets/config                                 | — (git-ignored)   |

Set the env vars to point these at a separate (e.g. private) location to keep personal
data out of the repo tree entirely. Defaults stay `REPO_ROOT/<dir>` for back-compat.

The `devhub-backport` flow (M4) branches off `upstream/main` and cherry-picks feature
files only, so personal data can never ride along into a public PR.

## M6 — deferred forever

Publishing a scrubbed public template (`TEMPLATE_AND_PLUGIN_PLAN.md` M6) is **not on the
active roadmap**. This private mirror _is_ the working model. Dual-repo cognitive load
(keeping a leak-free public tree + scanner + flip ceremony) is not worth the payoff right
now. If a public template is needed later, start a new project — do not treat M6 as
"almost done."

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

### A stale `next start` will lie to you

If a change doesn't appear, check for an old server before debugging the code:

```sh
lsof -t -iTCP:1337 | xargs kill -9      # pkill -f often fails to match
```

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

Repo health first rendered a warning on 38 of 52 repos, mostly "no activity in N
days". On a machine with 52 checkouts, dormant is normal. If a signal appears on
most rows it is decoration, not triage — split what's genuinely actionable from
what's merely true, and let silence mean "fine".
