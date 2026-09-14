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
| README control-layer GIF (`docs/assets/demos/control-layer.gif`) | `npm run demos:record` (VHS + a disposable fixture) |

## Playwright (feature pages)

Use the existing Playwright journeys instead of a separate recorder. They already know how to start the dashboard, wait for hydration, and avoid writes on sensitive routes.

Run one browser engine to keep the output small:

```bash
PLAYWRIGHT_VIDEO=1 npm run test:e2e --prefix dashboard -- --project=chromium
```

Playwright writes videos under `dashboard/test-results/`. Keep that directory local while reviewing and trimming the recordings.

## README control-layer GIF

The README demo is a VHS tape (`scripts/demos/control-layer.tape`) that runs a real sync and real MCP calls. Pointed at a live machine it would overwrite tool configs and notes, so `scripts/demos/record.sh` builds a throwaway checkout (committed shared content only — no notes, tasks, collections, or `persona/identity.txt`) plus a throwaway `HOME`.

```bash
# Requires vhs (brew install vhs) and dashboard + MCP server node_modules
npm run demos:record
```

Constraints:

- The fixture is `git archive HEAD`. Uncommitted files are absent — commit `call-tool.mjs` and `dashboard/scripts/run-action.ts` before recording.
- The tape refuses to run unless `DEVHUB_DEMO_FIXTURE` (default `/tmp/devhub-demo-fixture`) contains the `.devhub-demo-fixture` marker. It will not `rm -rf` a directory it did not create.
- `devhub` in the recording is a shell function wrapping `dashboard/scripts/run-action.ts` and `mcp-servers/devhub-server/scripts/call-tool.mjs`.
- `vhs` can exit 0 when ffmpeg wrote nothing — the script fails if the GIF is missing or empty.

Override the fixture path with `DEVHUB_DEMO_FIXTURE`. Review every frame before publishing.

## Use safe data

- Point `NOTES_DIR`, `TASKS_DIR`, and the other content directories at disposable fixtures.
- Disable Jira, Calendar, Datadog, AI, and company plugins unless the recording specifically needs a sanitized fixture.
- Review every frame for names, tokens, URLs, and private content before publishing.
- Add captions or a short transcript so the demo is useful without audio or video.

## Publish

Do not link to an agent workspace or temporary CI artifact. The README GIF lives in-repo under `docs/assets/demos/`. Other approved clips can go on a GitHub Release, then link the durable asset from the relevant feature guide.

Record the commit SHA and recording date beside each published clip. Delete obsolete clips when the UI no longer matches them.
