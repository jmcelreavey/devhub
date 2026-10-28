# Task↔run link and durable handoff

Read from `devhub-implement-task` §0.5 when starting, resuming, pausing or handing off a run.

Every implement session must leave a resume-ready trail on the task:

**Storage / MCP contract**

| Concern | MCP | HTTP |
| --- | --- | --- |
| List / upsert linked runs | `tasks_agent_runs` | `GET/POST /api/tasks/agent-runs` |
| Read handoff | `tasks_agent_handoff_get` | `GET /api/tasks/agent-runs/handoff?taskId=` |
| Write handoff | `tasks_agent_handoff_set` | `PUT /api/tasks/agent-runs/handoff` |
| Resume (follow-up or new) | `tasks_agent_resume` | `POST /api/tasks/agent-runs/resume` |

Sidecar files live at `notes/.config/task-agent-runs/<taskId>.json` (plus `_index.json` for runId→taskId). Run `status` values: `queued` \| `running` \| `paused` \| `done` \| `failed` \| `abandoned`.

**On start (and after any `agent_dispatch` / dock run id is known)**

1. `tasks_agent_runs` with `taskId` + `runId` (+ `provider`, `status: "running"`).
2. If resuming, prefer `tasks_agent_resume` (or UI **Resume with Agent…**), which injects handoff + plan URL. Otherwise call `tasks_agent_handoff_get` **before** coding and treat the markdown as the source of truth for prior progress, branch/PR, blockers, and next steps.

**Interactive CLI (Implement / Resume / Continue in the terminal dock)**

When the prompt includes a DevHub Agent Activity run id (injected by the UI):

Post a separate `agent_interactive_note` for **each** milestone — do not batch into one end-of-run dump:

1. **Check-in** (before any code): goal, assumptions, questions (or "no questions").
2. **After I answer** (or you proceed with no questions): what we decided.
3. **Tooling / verify / review**: when you finish a review note, open Cursor or another tool, start or finish tests/CI, or change the plan.
4. **My instruction**: when I ask you to commit, push, open a PR, pause, or stop — note that before you act.
5. **After commit / push / PR**: branch, SHA or PR URL, verify status.

When the implement goal is done (or I tell you to stop), call `agent_interactive_finish` with `runId`, `ok`, your CLI `sessionId`, and a short `resultText` (or `error`) — **even if the terminal stays open**. Closing the tab only auto-closes the run as a backup and does not record the session id.

On **Resume / Continue**, the prompt includes those Activity notes under `prior Agent Activity notes` — treat them as the source of truth for what already happened (check-ins, decisions, commits) and continue from there; do not re-ask settled questions.

**Before pause, end-of-day, or abandon**

1. Write/update handoff via `tasks_agent_handoff_set` (use `mode: "append"` only for additive checkpoints; prefer a full replace that stays current).
2. Include at least: what changed, branch/PR/session if any, verify status, open questions, and the exact next action.
3. Point at notes, the plan, the Jira ticket, commits, and diffs by path or URL. Do not paste them again.
4. Name the skills the next session should load.
5. If you know what that session is for, write the handoff for that job, not a diary of this one.
6. Redact secrets, tokens, and customer data.
7. Set the linked run to `paused` (EOD/pause) or `abandoned` (giving up) via `tasks_agent_runs`.

Points 3 to 6 are adapted from Matt Pocock's `handoff` skill (MIT).

Do not rely on chat scrollback alone — the handoff is what the next session reads first.

When any linked run ends, DevHub appends a `### Run <runId>` snapshot to the handoff (branch, last commit, changes vs base, uncommitted files, session). Write your own notes above it; don't repeat what the snapshot already says.

**After the PR exists** DevHub watches it (`tasks_pr_watch`, every 10 minutes): failing CI, requested changes or new comments show on the task as **Fix PR with Agent**, and a merge offers **Complete task**. When you are resumed for a PR finding, the prompt starts with `FIX THE PULL REQUEST FIRST` — read the full failure with `gh pr checks` / `gh pr view --comments`, fix it on the same branch, and ask before pushing.
