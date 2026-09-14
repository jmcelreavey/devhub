---
title: Recording feature demos
description: Capture sanitized feature walkthroughs with the existing Playwright journeys and repo-controlled output.
section: contributing
order: 5
icon: Monitor
tags: [contributing, testing]
related:
  - contributing/desktop-development
  - reference/scripts
---

# Recording feature demos

Two recorders, two jobs:

| Job | Tool |
| --- | ---- |
| In-app UI walkthroughs (notes, PRs, setup) | Playwright journeys with `PLAYWRIGHT_VIDEO=1` |
| README dashboard GIF (`docs/assets/demos/dashboard.gif`) | `npm run demos:record` (Playwright + a disposable fixture) |

## Playwright (feature pages)

Use the existing Playwright journeys instead of a separate recorder. They already know how to start the dashboard, wait for hydration, and avoid writes on sensitive routes.

Run one browser engine to keep the output small:

```bash
PLAYWRIGHT_VIDEO=1 npm run test:e2e --prefix dashboard -- --project=chromium
```

Playwright writes videos under `dashboard/test-results/`. Keep that directory local while reviewing and trimming the recordings.

## README dashboard GIF

The README demo walks the real dashboard: Today's tasks, a note, syncing the persona to every tool, and searching shared memory. The sync writes tool configs under `$HOME` and the walk writes tasks, so `scripts/demos/record.sh` never touches your machine's data:

1. Builds a throwaway checkout from `git archive` (no notes, tasks, collections, reps, upstarts, or `persona/identity.txt`) and a throwaway `HOME`.
2. Seeds demo notes and tasks through the real DevHub MCP server (`call-tool.mjs`).
3. Starts the dashboard with `env -i` and only fixture paths, so no integration secrets, plugins, or 1Password lookups reach the recording.
4. Runs `dashboard/scripts/record-readme-demo.ts`: Playwright drives Chromium, a CDP screencast captures frames, and sharp encodes the GIF. No ffmpeg or VHS.

```bash
# Requires dashboard + MCP server node_modules and Playwright's Chromium
npm run demos:record
```

Constraints:

- The fixture is `git archive $DEVHUB_DEMO_REF` (default `HEAD`). Uncommitted files are absent.
- The fixture path shows on screen (Skills page, sync logs), so keep the default `/tmp/devhub-demo-fixture` or another path without your username. The script refuses to `rm -rf` a directory without its `.devhub-demo-fixture` marker.
- The walk lives in `record-readme-demo.ts`. When a page's labels change, update its selectors there; the script fails loudly rather than recording a blank scene.
- Key frames are written to `$DEVHUB_DEMO_FIXTURE/frames`. Review every one before publishing.

## Use safe data

- Point `NOTES_DIR`, `TASKS_DIR`, and the other content directories at disposable fixtures.
- Disable Jira, Calendar, Datadog, AI, and company plugins unless the recording specifically needs a sanitized fixture.
- Review every frame for names, tokens, URLs, and private content before publishing.
- Add captions or a short transcript so the demo is useful without audio or video.

## Publish

Do not link to an agent workspace or temporary CI artifact. The README GIF lives in-repo under `docs/assets/demos/`. Other approved clips can go on a GitHub Release, then link the durable asset from the relevant feature guide.

Record the commit SHA and recording date beside each published clip. Delete obsolete clips when the UI no longer matches them.
