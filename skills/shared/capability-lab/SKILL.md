---
name: capability-lab
description: >-
  Build a hands-on, repo-grounded learning lab for a Capability Radar signal
  (a technology, pattern, or concept detected in a repo). Explores the real
  repo, writes a runnable starter project into the lab workspace, saves the
  lab note via the notes MCP, and registers the lab with the DevHub dashboard
  by POSTing the given adopt URL. Use when the dashboard "Build lab" button
  fired `opencode run` with a signal id, repo path, workspace directory, and
  notes MCP path — or when the user asks to build/rebuild a capability lab.
metadata:
  short-description: Build a repo-grounded learning lab
---

# Capability Lab Builder

## Overview

Turn a detected signal (e.g. "MongoDB in capi", "Flux in eks-config") into a
hands-on learning lab with three deliverables, in this order:

1. **A runnable starter project** under `<workspace>/starter/` the learner can
   run, break, and extend.
2. **A lab note** (markdown via the notes MCP) that teaches the concept using
   this repo as the concrete example, structured for the dashboard UI.
3. **Registration**: a POST to the adopt URL so the dashboard records the lab,
   links evidence, and creates the follow-up task. Without this the UI never
   shows the lab — never skip it.

The launch prompt supplies: the signal label + id, the repo name, a **plan
URL**, and an **adopt URL**.

## 0. Fetch the plan

First, curl the plan URL from the prompt:

```bash
curl -sf '<plan-url>'
```

It returns JSON with everything else you need: `repoPath` (grounding repo
clone), `workspacePath` (where the starter goes), `evidence` (files that
triggered the signal), `introduced` (introducing commit), `recent` (recent
commits), `language` (starter language), `services` (local services), and
`notePath` (notes MCP path for the lab note).

## 1. Explore the repo (ground everything)

Start from the plan's evidence files, then dig deeper yourself:

- Read the evidence files and the code around them — how is the signal wired
  in *this* repo (config, env vars, connection strings, CI steps)?
- Check the introducing commit (`git log`/`git show`) for the why.
- Find 2–4 more files the evidence points at (imports, services, tests).

Cite only files and commits you actually opened. If evidence is thin, narrow
the lab's scope instead of inventing.

## 2. Write the starter project

Create files under `<workspace>/starter/` (create the directory if needed —
but do NOT touch `README.md`, `STEPS.md`, or `docker-compose.yml` at the
workspace root; the dashboard generates those on adoption).

Rules:

- **Write it in the plan's starter language** (usually TypeScript /
  Node.js — the learner's working stack). Only deviate when the signal is
  inherently tied to another language; config-as-code signals (YAML,
  Terraform, dashboards, CI) still get a harness in the requested language.
- 2–6 small files, mirroring the patterns visible in the repo — same client
  libraries, same config names, same document/resource shapes.
- It MUST run end-to-end out of the box and print a clear, observable result.
  If local services are listed (e.g. mongo), wire to them on localhost and
  note that `docker compose up -d` starts them (compose is generated at the
  workspace root on adoption).
- Include a self-check (assertions or a `verify` step) that prints PASS/FAIL.
- Add 2–4 checkable TODO comments that teach the concept — each should change
  the observable output when done.
- Include `starter/README.md`: learning goal, how to run, what to modify, how
  to verify. Run the starter yourself once to confirm it works; fix it if not
  (services may not be running — that's fine, verify what you can statically).

## 3. Write the lab note (notes MCP)

**Write through the notes MCP, never by creating files directly.** Use
`notes_write` with the exact `notePath` from the plan. Pass markdown.

Use EXACTLY these headings, verbatim (the dashboard builds navigation chips
and a workspace checklist from them — do not append anything to the heading
text):

```
# <Label> in <repo> — hands-on lab
## Objective
## 1. Orient
## 2. Read the change
## 3. Sandbox
## 4. Socratic checkpoint
## 5. Explain-back
## 6. Debug mission
## Takeaway
```

Section requirements — fill every one completely; never truncate:

- **Objective**: 2–3 bullets — concrete things the learner can do afterwards.
- **1. Orient**: what the technology/pattern is and why it's in this repo.
- **2. Read the change**: the introducing commit plus the specific evidence
  files to open, with what to look for in each.
- **3. Sandbox**: ONE concrete task to RUN in the workspace — exact commands
  (start services, run/extend the starter, observe output). Reference the
  actual starter files you wrote.
- **4. Socratic checkpoint**: exactly 3 questions, hardest last; at least one
  conceptual/transferable, not repo-specific.
- **5. Explain-back**: one prompt asking the learner to summarise it in their
  own words.
- **6. Debug mission**: a realistic failure — symptom, how to reproduce it in
  the workspace, exact diagnosis commands, and the fix.
- **Takeaway**: 1–2 sentences on the transferable concept beyond this repo.

Style: second person, practical, no fluff; depth over breadth. Write every
file reference as a backticked relative path (e.g. `src/mongo/mongo.service.ts`,
`starter/main.ts`) so the UI turns it into an editor link. Never invent paths,
commands, commit hashes, or vendors.

On a REBUILD, overwrite the note at the same path and refresh the starter
files in place (keep the learner's other workspace files alone).

## 4. Register the lab (required)

Finish by POSTing the adopt URL from the prompt, with the signal id and repo
name from the plan:

```bash
curl -sf -X POST <adopt-url> \
  -H 'Content-Type: application/json' \
  -d '{"signalId":"<signalId>","repoName":"<repoName>"}'
```

A JSON response with `"ok": true` means the dashboard registered the lab
(record, evidence links, follow-up task, workspace README/STEPS/compose). If
it errors, report the error output — do not silently finish. If the response
lists `unverifiedPaths`, double-check those citations in the note and fix them
with another `notes_write`, then adopt again.

## Checklist before you're done

- [ ] Starter runs (or is statically verified) and prints a PASS/FAIL check.
- [ ] Note saved via `notes_write` at the exact given path, headings verbatim.
- [ ] Every cited path exists in the repo or workspace.
- [ ] Adopt URL POSTed and returned `ok: true`.
