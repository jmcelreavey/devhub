---
name: devhub-dashboard-verify
description: Verify DevHub dashboard UI changes with the correct local server and browser tooling.
metadata:
  short-description: Don't test dashboard UI on :1337
---

# DevHub Dashboard Verify

## Overview

On this machine, **localhost:1337 is the packaged desktop app** (`next start`
from `/Applications/DevHub.app`), not `npm run dev`. Checkout edits will not
appear there. Testing a UI fix against 1337 is testing production.

## When To Use

- Browser / Playwright / screenshot verification of dashboard UI
- "is my change live?", HMR, or "why didn't the page update?"
- Anything that would `open http://localhost:1337`

## Workflow

1. **Do not use :1337 for checkout testing.** Treat it as production.
2. Confirm who owns a port before hitting it:

   ```bash
   lsof -nP -iTCP:1337 -sTCP:LISTEN
   # packaged: cwd is /Applications/DevHub.app/Contents/Resources/server
   # webpack: cwd is this checkout's dashboard/, argv includes run-next-with-env.ts dev
   ```

3. Start webpack on a **free** port (1337 is usually taken). Example:

   ```bash
   cd dashboard && PORT=1342 npx tsx scripts/run-next-with-env.ts dev --port 1342 --hostname 127.0.0.1
   ```

   Then verify against that origin. Cold compile can take ~30s.
4. **Do not kill 1337** unless the user asks — that process is the daily driver.
5. To get a checkout fix into the packaged app: **View → Rebuild Dashboard…**
   (or attach the shell to the webpack origin). Reopen does not rebuild.

## Rules

- `npm run dev`'s *default* port is 1337. That is not who is listening when
  DevHub.app is open.
- A working page on 1337 does not mean your working-tree change shipped.
- Packaged `next start` has no webpack HMR. Reloading 1337 will not pick up
  files you just edited in this checkout.
