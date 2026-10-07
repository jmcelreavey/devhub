---
title: Recording feature demos
description: Capture sanitised feature walkthroughs with the existing Playwright journeys and repo-controlled output.
section: contributing
order: 5
icon: Monitor
tags: [contributing, testing]
related:
  - contributing/desktop-development
  - reference/scripts
---

# Recording feature demos

Four recorders, four jobs:

| Job | Command | Output |
| --- | ------- | ------ |
| README dashboard GIF | `npm run demos:record` | `docs/assets/demos/dashboard.gif` |
| Feature walkthroughs for the docs and the README | `npm run demos:walkthroughs` | `docs/assets/demos/<clip>.mp4` and `<clip>.gif` |
| Illustrated flows a fixture can't show | `npm run demos:illustrations` | `docs/assets/demos/<name>.gif` |
| Vendored-skill GIFs | `npm run skills:demos` | `docs/assets/demos/<skill>.gif` |

The first two share one script, `scripts/demos/record.sh`, and one disposable fixture. `npm run demos:record -- all` records both in one fixture build.

For debugging a Playwright journey rather than publishing a clip, `PLAYWRIGHT_VIDEO=1 npm run test:e2e --prefix dashboard -- --project=chromium` writes videos under `dashboard/test-results/`. Don't publish those: they run against whatever data your dashboard has.

## README dashboard GIF

The README demo walks the real dashboard: Today's tasks, a note, syncing the persona to every tool, and searching shared memory. The sync writes tool configs under `$HOME` and the walk writes tasks, so `scripts/demos/record.sh` uses disposable content and tool-config directories:

1. Builds a throwaway checkout from `git archive` (no notes, tasks, collections, reps, upstarts, or `persona/identity.txt`) and a throwaway `HOME`.
2. Seeds demo notes and tasks through the real DevHub MCP server (`call-tool.mjs`).
3. Starts the dashboard with `env -i` and only fixture paths, so no integration secrets, plugins, or 1Password lookups reach the recording.
4. Runs `dashboard/scripts/record-readme-demo.ts`: Playwright drives Chromium, a CDP screencast captures frames, and sharp encodes the GIF. No ffmpeg or VHS.

```bash
# Requires dashboard + MCP server node_modules, Playwright's Chromium and the sqlite3 CLI
npm run demos:record
```

By default the fixture dashboard runs a production build (`next build --webpack`, about a minute) so clips don't stall on dev compiles. `DEVHUB_DEMO_SERVER=dev` skips the build while you work on a walk.

## Feature walkthroughs

`npm run demos:walkthroughs` records one short clip per feature with `dashboard/scripts/record-walkthroughs.ts`. Each clip is a CDP screencast at 1280×800. The MP4 is resampled to 25 fps and encoded to H.264 by **ffmpeg** (`brew install ffmpeg`), so it's sharp and small — about 100–250 KB. The GIF is what the README shows; it's encoded with sharp at 1024×640, merging identical frames, so it's usually 200–700 KB.

| Clip | Output | Shown in |
| --- | --- | --- |
| Today, Work, Notes, command palette, Diagrams and docs, Repos | `<clip>.mp4` and `<clip>.gif` | docs, and the README |
| System | `system.mp4` only (`gif: false`) | docs |
| Integrations, Review assignment, Git client, Databases, Skills and voice, Conventions, Token usage | `<clip>.gif` only (`mp4: false`) | README |

The fixture adds what the walks need on top of the README seed: a project note, a diagram, three completed days of tasks, and two local git repos. `payments-api` also carries a SQLite file (`orders.db`) for the Databases clip, and `search-service` has a GitHub remote URL that is never fetched, plus a seeded rule file so Conventions has something to show. The repo, reviewers and comments are invented. It also points Paseo at a dead port and stubs the LAN-address badge. The Token usage clip stubs `/api/agent-usage` during both warm-up and capture: a throwaway `HOME` doesn't isolate the macOS Keychain. These controls don't scrub text already in the checkout; review the frames before publishing.

Terminal has no clip. The dock talks to a PTY peer on `:1339`, which on a real machine belongs to your own DevHub, and the fixture doesn't start one. Don't point a recording at that port.

Embed a clip with a relative link on its own line:

```markdown
[Today: tasks, plans and progress](../assets/demos/today.mp4)
```

DevHub's docs viewer renders a lone `.mp4` link as an inline player (served by `/api/docs-assets`, with range support for WebKit); GitHub shows it as a link. Both work in the public template, because the file lives in `docs/`.

To work on one walk: `DEVHUB_DEMO_SERVER=dev npm run demos:record -- serve` keeps the fixture dashboard up, then run the recorder against it with `DEMO_URL=http://127.0.0.1:1350 DEMO_OUT_DIR=/tmp/out DEMO_FRAMES_DIR=/tmp/frames DEMO_ONLY=notes npx --prefix dashboard tsx dashboard/scripts/record-walkthroughs.ts`.

Features that need a real account — PRs, Calendar, Jira, Datadog, the briefing, notes AI — have no clip. Don't record them against live data.

## Illustrated flows

Some flows can't be recorded honestly: implementing a ticket needs a live agent, real model access and Cursor. `npm run demos:illustrations` renders each `docs/assets/demos/src/<name>.html` into `docs/assets/demos/<name>.gif` with `dashboard/scripts/record-illustrations.ts`. It needs no fixture or server.

A page exposes `window.__play()` to start its timeline and sets `window.__done` when it finishes. Each one must label itself as an illustration on screen, and anywhere it's embedded, so nobody takes it for a capture. Use the real theme's colours (the page copies the Graphite Neon preset from `dashboard/app/globals.css`) and invent every name and number.

If you can screen-record the real thing, save it over `<name>.gif` and delete the source page.

Constraints:

- The fixture is `git archive $DEVHUB_DEMO_REF` (default `HEAD`). Uncommitted app files are absent; recorder scripts run from your working checkout. To include uncommitted app changes without altering your branch or real index, use the temporary-index recipe below. It snapshots all non-ignored working files, so inspect the resulting file list and keep the commit local.
- The fixture path shows on screen (Skills page, sync logs), so keep the default `/tmp/devhub-demo-fixture` or another path without your username. The script refuses to `rm -rf` a directory without its `.devhub-demo-fixture` marker.
- Walks live in `record-readme-demo.ts` and `record-walkthroughs.ts`. When a page's labels change, update the corresponding selectors; the script should fail rather than record a blank scene.
- Key frames are written to `$DEVHUB_DEMO_FIXTURE/frames`. Review every one before publishing.

From the repo root, this prints a local snapshot commit without changing the real index or branch:

```bash
(
  set -eu
  demo_index_dir=$(mktemp -d)
  trap 'rm -rf -- "$demo_index_dir"' EXIT
  export GIT_INDEX_FILE="$demo_index_dir/index"
  git read-tree HEAD
  git add -A
  git commit-tree "$(git write-tree)" -p HEAD -m 'chore: snapshot demo fixture'
)
```

Use the printed SHA as `DEVHUB_DEMO_REF`. Don't push this snapshot.

## Reviewer and database demos

`review-assignment.gif` records the implementation launch sheet with a fixture assistant catalogue. It selects separate implementation and review models, then closes without starting an agent or saving preferences.

`database.gif` uses the fixture's SQLite orders database. It adds the discovered file, browses the schema and replaces the editor's default query before running SQL. The core UI copy is generic; company connections arrive through plugins.

## Use safe data

- Point `NOTES_DIR`, `TASKS_DIR`, and the other content directories at disposable fixtures.
- Disable Jira, Calendar, Datadog, AI, and company plugins unless the recording specifically needs a sanitised fixture.
- Review every frame for names, tokens, URLs, and private content before publishing.
- Add captions or a short transcript so the demo is useful without audio or video.

## Publish

Do not link to an agent workspace, a temporary CI artifact, or `/api/notes-assets/...` — note assets are private to your mirror, so those links are dead in the public template and on GitHub. Published clips live in-repo under `docs/assets/demos/`.

Put the source commit (`DEVHUB_DEMO_REF`, default `HEAD`) and recording date in the commit message that adds or replaces clips. Re-record when the UI a clip shows changes, and delete clips nothing links to.
