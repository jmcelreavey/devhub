# Fork Workflow — Pull & Push with the Public Core

DevHub is distributed as a **private mirror of a shared public core**. You run your own
copy (your notes, tasks, persona, private plugins) and stay in sync with the public
`devhub` repo: pulling improvements down, and contributing generic features back up.

This guide is the day-to-day how-to. For the full repo topology, first-time mirror setup,
and the personal-data boundary, see [`CONTRIBUTING.md`](../../CONTRIBUTING.md). For private
company/personal features, see [Plugins](../architecture/plugins.md).

## The model (why it's not a normal merge)

The public core has an **unrelated git history** — it's seeded from a clean tree so your
private history never leaks. That means you can't `git merge`/`rebase` across the two.
Both directions instead port *content diffs* with `git apply --3way`:

- **Pull** (`scripts/devhub-update.sh`) applies new upstream changes onto your mirror.
- **Push** (`scripts/devhub-backport.sh`) ports a generic feature onto a branch off
  upstream and opens a PR.

The last-pulled upstream commit is tracked in the git ref `refs/devhub/upstream-sync`.

## Pulling core updates

### From the dashboard (recommended)

On the **Actions** page:

1. Run **Pull Core Updates (Preview)** — read-only. It fetches upstream and lists the
   incoming commits + diff stat. Nothing changes.
2. If the incoming changes look right, run **Pull Core Updates** — it applies them onto
   your mirror, commits, advances the sync marker, then validates and re-syncs your tools.

Your live-dirty personal files (`tasks/`, `notes/`, `collections/`) don't block a pull —
the guard only stops on *non-personal* uncommitted changes that could collide with the
apply. Commit or stash those first.

### From the CLI

```bash
scripts/devhub-update.sh --dry-run   # preview incoming changes
scripts/devhub-update.sh             # apply + validate + sync
```

First run only, before the marker exists, pass the upstream commit your mirror last matched:
`scripts/devhub-update.sh --since <upstream-ref>`.

## Pushing a feature upstream (backport)

Only **generic, non-company, non-personal** features belong in the public core. Company or
personal logic stays in a [plugin](../architecture/plugins.md); personal data is auto-excluded.

This stays a **deliberate terminal action** — it opens a public, effectively irreversible
PR, so there's no dashboard button. Preview first, always:

```bash
scripts/devhub-backport.sh <source-ref> [--base <ref>]            # preview (default)
scripts/devhub-backport.sh <source-ref> [--base <ref>] --execute  # push branch + open PR
```

It branches off `upstream`, applies the feature's hunks (3-way, so public-side
templatisation survives), runs the **leak scan on added lines**, and prints the diff stat.
Confirm the file list is only your feature before `--execute`.

After the PR merges, your mirror already contains what you sent public, so **don't pull it
back** — just advance the marker:

```bash
scripts/devhub-update.sh --mark-synced
```

## One-shot ship (private mirror + public core + plugins)

When you want to push **everything** in one deliberate flow — personal data, code, the
public core, and enabled plugin repos — use `scripts/devhub-ship.sh` (or MCP `repo_ship` +
`repo_ship_status`):

```bash
bash scripts/devhub-ship.sh "feat: my feature"   # from main/master
bash scripts/devhub-ship.sh --dry-run            # preview paths only
bash scripts/devhub-ship.sh --no-upstream        # skip public-core push
```

The script:

1. Commits `notes/`, `tasks/`, and `collections/` as their own commit (private-only paths).
2. Commits all remaining work with your message.
3. Pushes `origin main` — the pre-push hook runs leak scan + `npm run verify` (takes minutes).
4. Ports the content diff onto `upstream` main **directly** (no PR) via `devhub-backport.sh`,
   then advances the sync marker.
5. Commits and pushes each enabled plugin repo from `~/.config/devhub/plugins.json`.

Personal paths never reach the public core; the backport step drops them and the leak scan
blocks internal names/secrets. For a **reviewed** public contribution, prefer the manual
backport + PR flow above instead.

## See also

- The **`devhub-fork-workflow`** skill loads this workflow on demand in AI tools (triggers:
  "backport this", "pull core updates").
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — topology, first-time setup, personal-data boundary, code standards.
- [Plugins](../architecture/plugins.md) and [Creating a Plugin](creating-plugins.md) — keeping private features out of the public core.
- [Scripts reference](../reference/scripts.md) — exact flags and guards.
