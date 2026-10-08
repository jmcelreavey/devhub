---
title: Tasks
description: "One file per task, with start and end dates, and how leftover day files are imported."
order: 3
tags: [architecture, tasks]
related:
  - architecture/dashboard
  - guides/task-profiles
  - architecture/notes-system
---

# Tasks

A task is one JSON file. It is visible on day D when `startDate <= D` and `D <= endDate` (or today, if it is still open). Open means not done, not abandoned, and no `endDate`. Slip is derived: still open, and `startDate` is before the day you are looking at.

Future open tasks show only on their `startDate`. A past day before `endDate` shows the task as it was then (still open). Done, abandoned, and ended tasks stay in history.

Order is a fractional `rank` on the open tasks. Reordering one task rewrites that one rank.

## Storage

`tasks/items/<id>.json`, or `tasks/<profile>/items/<id>.json` when a profile is active. Reserved directory names are `items`, `legacy`, and `deleted`. They are not profile ids.

One file per task is the shape git can merge. A day file is a copy of every open task, so two machines editing two different tasks still conflict on the same file. Separate files conflict only when both sides edit that task.

JSON is deterministic: known keys in a fixed order, then any unknown keys sorted, two-space indent, trailing newline. Link order and unknown link fields are kept. `writeItem` skips a write when the bytes already match, so a no-op import does not touch mtime.

Timers are not in the item. They live in `tasks/.local/timers.json` (and `tasks/<profile>/.local/timers.json`). Those directories are gitignored and excluded from content sync. One timer runs per tasks directory.

Deleting an item that came from legacy day files writes `tasks/deleted/<id>.json`:

```json
{ "id": "<id>", "deleted": true, "legacyIds": ["<id>"] }
```

That file is synced. Readers skip it. The importer will not recreate the item from older day files.

## What a day looks like

Today, history, weekly review, and recall all read the same items and project them onto a date. There is no per-day task file to roll forward.

| Action | What changes |
| --- | --- |
| Add | New item, `startDate` = the day you added it, rank at the end of the open list |
| Complete or abandon | `endDate` = the local calendar day of the action (`todayISO`) |
| Reactivate | Clears done, abandoned, `endDate`, and `endReason` |
| Delete | Removes the item. Legacy-backed items leave a tombstone under `tasks/deleted/` |
| Reorder | One rank changes |

`GET /api/tasks` returns `{ date, tasks, migrationNotice? }`. The notice is set when an import skipped a file or left rows unimported.

## Profiles

The active profile is the directory this machine writes. Other profiles are an overlay of their **open** items, including a task that has been open since before the new model. The overlay is not "the newest day file".

`DEVHUB_PROFILE` selects the directory and overrides `~/.config/devhub/profile.json`. See [Task profiles](../guides/task-profiles.md).

## Migration

The first tasks read on startup, and the first tasks read in a request, imports legacy day files. MCP does the same on the first `tasks_*` call for its directory. Concurrent callers share one in-flight import. A second call is a fingerprint check unless a legacy file changed.

Legacy files are `tasks/YYYY-MM-DD.json`, `tasks/YYYY-MM-DD.local.json`, and the same names under `tasks/legacy/` (including `legacy/conflicts/`). Nothing in the current app writes a `.local.json` day file. The importer still reads one if it is there, as extra rows for that day. After a successful import, day files move into `tasks/legacy/`. Identical bytes are unlinked. Different bytes land in `tasks/legacy/conflicts/<12-char sha256>-<basename>`.

Rows collapse into one item when they share an id, when `rolledFromId` points at another row (even if that row is missing), when `movedToDate` plus the trimmed text finds the destination row, or when the same trimmed text is still open on the next **existing** day file. A weekend with no day file is not a gap. A day file in between that does not contain the text is a gap, and the tasks stay separate. Ambiguous text matches stay unlinked and are counted.

Done beats open and abandoned. Abandoned beats open. Two done rows keep the earliest completion. The surviving id is the earliest legacy id (lexicographically smallest if several share that date). `legacyIds` is the sorted unique set. `endDate` for a done or abandoned task is the **file name** of the row that closed it, not the UTC date of `completedAt`. In UTC+1, a completion just after local midnight must not land on the previous day.

A chain that is only `movedAt` rows, with no open, done, or abandoned row left, gets `endDate` and `endReason: "legacy-moved"`. It stays off Today. History shows "Ended when the later copy was removed". The report counts these and keeps samples.

Re-import is content-based, not date-gated. Each migrated item keeps `legacyRowDigests`: a sorted ledger mapping the SHA-256 digest of each consumed row version to a separate digest of its closure. `legacyDigest` hashes that ledger. Row digests use the file date and parsed task fields, with object keys sorted recursively. File paths, row order, formatting, and local timers are not content. `movedAt` contributes only whether the row was moved, not its timestamp: two machines can roll the same task forward at different times. `movedToDate` and the other parsed task fields still count, including completion/abandonment timestamps and accumulated `timeSpentMs` (recorded work, not a running timer). The importer keeps raw row versions before duplicate collapse; otherwise an archived copy could win the text tie-break and hide a same-day edit.

If no new row version is present, the item stays byte-for-byte alone, including its mtime. Otherwise only unseen row versions supply fields and time. Only unseen closure digests can complete, abandon, or end it, with the same precedence and earliest-completion rules. Editing the text of an old done row does not replay that unchanged closure over a reactivation. The ledger retains consumed versions even if a legacy file disappears, so a later sync cannot replay them. It also records rejected versions: a stale open row or a later duplicate completion may change only migration metadata while the item stays done. Without that record, re-syncing the same row after a reactivation could overwrite a new-model text edit or close the item again. The real-data harness therefore compares every non-metadata field for stale overlays, while keeping strict byte comparisons for independent imports and no-op re-runs. Tombstones always win.

Items imported before this ledger existed use `legacyThrough` once to establish a baseline: rows through that date are recorded without changing the item’s fields or closure, and later rows still apply. Subsequent imports compare content, including same-day changes. There is no reliable previous-content comparison for a pre-ledger item, so this deliberately favours keeping edits made in the new model.

An unreadable day file (invalid JSON, or git conflict markers) stays where it is. The rest of the directory still imports. The file is listed on the report and on `migrationNotice`. Its bytes are part of the fingerprint, so editing it retries the import. An unreadable item file is skipped the same way. The tasks page still serves the items it could read. If any row could not be placed (`dropped > 0`), day files stay put and no success fingerprint is written.

Agent-run sidecars under `notes/.config/task-agent-runs/` are rewritten onto the surviving id during the import. Every legacy-id file in the chain is folded into that id. When the same run is in two files, the newest copy is kept. An unreadable run file stays where it is and is not deleted. `_index.json` and `_index.local.json` are indexes, not task ids. The backup taken before the first write includes those files.

The backup goes to `DEVHUB_TASK_MIGRATION_DIR`, or `$DEVHUB_CONFIG_DIR/task-migrations/<sha256 of the tasks dir realpath>` (`~/.config/devhub` when the config dir is unset). Tests use `os.tmpdir()/devhub-task-migration` so they do not write into the home config. The import locks with an in-process mutex plus a `wx` lock file. A dead pid or a lock older than about 20 seconds is stale. A live lock is not deleted.

### When the import does not run

The import writes into the content dir, so `ensureTasksMigrated()` (`dashboard/lib/tasks/storage.ts`) skips it:

- during `next build` (`NEXT_PHASE=phase-production-build`);
- under test unless the tasks dir sits inside the OS temp dir. A test that never set a content root resolves to the checkout's own `tasks/` and must not touch it (`migration-guard.test.ts`).

At startup `instrumentation.ts` **awaits** the import. Next holds requests until `register()` settles, so the first Today render never sees a half-migrated directory. A failed import is logged and the server still starts on whatever items exist.

## The local day

`todayISO()` is the **local** calendar day, and there is one implementation (`shared/tasks/dates.ts`; `dashboard/lib/utils.ts` re-exports it). Complete and abandon set `endDate` from it, so finishing a task at 00:30 local time lands on today, not yesterday. The same helper names the daily note (`daily/YYYY-MM-DD`), so in the hour after local midnight the daily note and "today" agree instead of pointing at yesterday's UTC date.

## Two machines

Deterministic JSON merges on its own when both sides generate the same files and neither has edited an item yet. If both machines import, then one edits an item before the other has pulled, git sees an add/add conflict on that item file. The same happens to a run sidecar: two machines that each hold run files for different ids of one chain both write `notes/.config/task-agent-runs/<surviving-id>.json` if both import before either has pulled.

Update one machine first. Let it import and sync (or push). On the second machine, pull **before** updating the app. An old build, once the day files have moved to `tasks/legacy/`, shows an empty Today. The tasks are in `legacy/` and are not gone. Then update. The new build imports from `legacy/` and writes `tasks/items/`.

Content sync runs `git add -A` on `tasks/` and does not resolve conflicts. `tasks/.local/` is ignored. `tasks/items/`, `tasks/legacy/`, and `tasks/deleted/` are included, including profile subdirectories. A conflicted item or day file is unreadable JSON. The importer skips it, serves everything else, and retries when the file is fixed.

## Related

- [Dashboard](dashboard.md) for the Today, history, and weekly surfaces
- [Task profiles](../guides/task-profiles.md)
- [Notes system](notes-system.md) for content sync
- [Environment variables](../reference/environment-variables.md) for `TASKS_DIR`, `DEVHUB_PROFILE`, and `DEVHUB_TASK_MIGRATION_DIR`
