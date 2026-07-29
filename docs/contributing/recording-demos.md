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

Use the existing Playwright journeys instead of a separate recorder. They already know how to start the dashboard, wait for hydration, and avoid writes on sensitive routes.

## Record

Run one browser engine to keep the output small:

```bash
PLAYWRIGHT_VIDEO=1 npm run test:e2e --prefix dashboard -- --project=chromium
```

Playwright writes videos under `dashboard/test-results/`. Keep that directory local while reviewing and trimming the recordings.

## Use safe data

- Point `NOTES_DIR`, `TASKS_DIR`, and the other content directories at disposable fixtures.
- Disable Jira, Calendar, Datadog, AI, and company plugins unless the recording specifically needs a sanitized fixture.
- Review every frame for names, tokens, URLs, and private content before publishing.
- Add captions or a short transcript so the demo is useful without audio or video.

## Publish

Do not link to an agent workspace or temporary CI artifact. Publish approved clips somewhere the repository controls, such as a GitHub Release, then link the durable asset from the relevant feature guide.

Record the commit SHA and recording date beside each published clip. Delete obsolete clips when the UI no longer matches them.
