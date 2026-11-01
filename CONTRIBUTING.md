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

## Source layout

The root npm workspaces include `apps/ui` (Next dashboard), `apps/desktop`
(Tauri shell and staging), `packages/mcp`, `packages/shared` and `packages/qa`.
Server domains live in `apps/core`. Runtime content such as `notes/` and `tasks/`
stays outside these packages. The old MCP launcher remains for synced client configs.

Install from the repo root with `npm install`, or use `npm ci` when a root
`package-lock.json` is present. Do not install the core MCP package separately.

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

- `npm run verify` from the repo root must pass (the fast Vitest suite and Node tests). CI also checks lint, types and the production build.
  Install the root workspaces first. Team's gateway is tested in its plugin repository.
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
| `apps/ui/.env.local` | Secrets/config                                 | — (git-ignored)   |
| `private/` | Mirror-only domain files, archived guides and assets | — |
| `.devhub/` | Local checkouts, caches and run state | — (never commit) |

Set the env vars to point these at a separate (e.g. private) location to keep personal
data out of the repo tree entirely. Defaults stay `REPO_ROOT/<dir>` for back-compat.

The backport workflow branches off `upstream/main` and applies only public code and
catalogue changes as content patches. `--snapshot` compares the final source tree against public main, rather than replaying commits. Public and private histories stay separate.
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

## Licence

The public core is **AGPL-3.0-only** ([`LICENSE`](LICENSE), `package.json`).
Contributions you send to the public repo are under that licence. Keep
`LICENSE` and the SPDX field when backporting; do not relicense the core in a
public PR.

Private mirrors and separate plugin repos are yours. The AGPL's network clause
matters if you offer a *modified* DevHub as a service to other people — the app
is designed for one person on a trusted machine and does not provide hosted
multi-user accounts. For commercial licensing or setup help, open a
[Discussion](https://github.com/jmcelreavey/devhub/discussions). Read
`LICENSE`; this is not legal advice.

## Traps

Things that have cost real time here. Each one looked like it worked and didn't.

### Checkout and plugins

`npm run dev` supervises core, Vite and the terminal on the checkout ports.
Build and startup do not copy plugin source into the dashboard. Edit plugins in
their own repos and use reviewed runtime registrations for their pages and APIs.

The packaged app normally uses 1337. Verify checkout changes on 1437 with
`DEVHUB_SCHEDULER=0`; keep the packaged app running.

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
