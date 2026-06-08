#!/usr/bin/env tsx
/**
 * Replaces the old shell setup wizard. Configuration lives in the app.
 */
import process from "node:process";

process.stdout.write(`
DevHub setup is in the web app:
  1. Start the dashboard: npm run dev (repo root) or cd dashboard && npm run dev
  2. Open http://localhost:1337/setup

First-time machine bootstrap (deps, sync, MCP, build): bash scripts/install.sh
`);
