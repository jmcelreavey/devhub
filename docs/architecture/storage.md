---
title: Local storage
description: Agent run SQLite activation, import and rollback.
---

# Local storage

Agent runs use SQLite by default through the existing run storage functions. Set
`DEVHUB_STORAGE_SQLITE=0` to use run folders. Tasks, jobs, scheduler and other
history remain file-backed. Task-agent run sidecars also remain files.

The database is `~/.local/state/devhub/devhub.db` by default. A scoped desktop
state profile uses `~/.local/state/devhub/profiles/<id>/devhub.db`; a desktop
using non-default `DEVHUB_APP_DATA` without a state profile uses
`<DEVHUB_APP_DATA>/logs/devhub.db`. `XDG_STATE_HOME` and the task profile don't
change this location. Run folders default to `<NOTES_DIR>/.config/agent-runs`;
`DEVHUB_AGENT_RUNS_DIR` overrides that path. Older runs may also be discovered
in the legacy temporary run directory.

## Activation

1. Stop every older dashboard, MCP and agent runner that could write the same
   folders. Old binaries continue writing files and cannot see SQLite changes.
   Don't mix file and SQLite writers for the same data.
2. Back up the run folders and database, including any `-wal` and `-shm` files,
   while all writers are stopped. Keep the backup private: runs contain prompts
   and agent output.
3. Rebuild the installed app with the updated code. Remove
   `DEVHUB_STORAGE_SQLITE=0` from the launch environment or desktop config and
   start the updated app. On the first access to each run root, it
   imports existing runs and request claims by ID. SQLite transactions prevent
   concurrent importers from duplicating rows or events. Source folders stay
   in place; new SQLite writes don't update them.
4. Open existing runs and their events, then create a run and check its status
   and events. Repeat for each state profile or distinct run root in use.

The importer keeps complete, valid event lines in order and skips corrupt lines;
source bytes remain available for export. A later access also imports a newly
found run folder. An existing SQLite record wins over later changes to that
folder; don't use an older file-writing app alongside it.

## Export and rollback

1. Stop the dashboard, MCP and all agent runners using this database. Use the
   same `HOME`, `DEVHUB_DESKTOP`, `DEVHUB_APP_DATA` and
   `DEVHUB_STATE_PROFILE` as that instance, and identify its actual run root.
   The exporter opens the database selected by those variables; a wrong profile
   can produce an empty export. Back up both database and run folders first.
2. Export into the existing run root. From a checkout with dependencies already
   installed, run:

   ```sh
   ./node_modules/.bin/tsx apps/core/src/domains/storage/export-runs.ts "$RUNS_DIR"
   ```

   For a packaged app, use its bundled Node and exporter instead:

   ```sh
   "$BUNDLED_NODE" "$RESOURCE_DIR/services/storage-export-runs.cjs" "$RUNS_DIR"
   ```

   On macOS, `RESOURCE_DIR` is the app's `Contents/Resources`; its Node is in
   `runtime/` (the binary may have a target-triple suffix). In WSL the payload
   root is `~/.local/share/devhub/runtime/<payload-id>`: use its `runtime/node`
   and set `RESOURCE_DIR` to that payload root. Select the payload belonging to
   the instance being rolled back. The exporter writes all runs and request
   claims in that database to the chosen root, retaining unrelated files.
3. If export reports a newer or unverified file, or a concurrent change, stop
   and reconcile the preserved files and database from the backups. Don't delete
   or overwrite the conflicting file to force an export. Confirm the export
   succeeded and the expected runs, events and claims are present.
4. Set `DEVHUB_STORAGE_SQLITE=0` in the launch environment or the desktop
   instance's configuration, then restart that instance and its runners in file
   mode. Check both an imported run and a run created after activation. Leave
   the database backup in place.

If file mode has written any runs and SQLite is to be enabled again, stop all
writers and back up the current run folders. Move `devhub.db` and any matching
`devhub.db-wal` and `devhub.db-shm` together to a private backup location; then
remove the flag and restart. The fresh database imports the current files. Simply
re-enabling SQLite against the old database would leave existing IDs at their
pre-rollback state. Keep both backups until the reimport is checked.

The desktop and WSL payload stage a pinned Node 22.22.3 and verify
`node:sqlite` during staging; the desktop self-test checks it too. The Docker
Linux builder installs Node 22 for staging. Runtime checks on the actual Mac,
WSL and Docker targets remain in the manual checklist.
