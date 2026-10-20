---
title: Auto, Jev QA and visual task notes
description: Plan for Auto mode to a draft PR, Jev QA at review, saved model sets with Jev routing, and agent-maintained visual task notes, with Storyboard lanes demoted to a view.
---

# Auto, Jev QA and visual task notes

Status: plan only, 16 October 2026. Paths are relative to `dashboard/` unless noted. Replaces the earlier lanes-first Storyboard redesign idea.

Phase order (John, 16 Oct): **1 Auto end to end → 2 Jev QA at review → 3 model sets and routing → 4 visual task notes**. Storyboard lanes become secondary.

## 1. Gap analysis

| Vision | Today | Gap |
|---|---|---|
| Implement from dashboard/tasks, pick a model set Jev routes between, saved | `components/agents/AgentLaunchSheet.tsx` has `ProviderSelect`/`ModelSelect` (`ProviderModelSelects.tsx`) and `EffortSelect.tsx`; model is remembered in localStorage per context (`devhub:agent-model:*`), effort per provider+model. `lib/storyboard/orchestrator.ts` dispatches the plan run via `lib/agent-runs/dispatch.ts` without `model`/`effort` (fields exist at dispatch.ts:50-52). `lib/qa/models.ts` only covers QA decision models. | No model *set*, no router, no server-side saved defaults, Auto ignores pickers. |
| Auto works end to end to a draft PR, waits for feedback, marks ready, review-request message | Orchestrator is "Phase 1": records an orchestration and dispatches the first plan run; does not advance steps. Statuses: `starting, running, needs-you, paused, pr-created, stopped, paused-manual` (`lib/storyboard/types.ts:243`). Consent rules in `lib/agent-runs/consent.ts`. PR watching in `lib/tasks/task-pr-watch.ts`. Slack and Telegram destinations exist for alerts (`lib/integrations/alert-types.ts`, `alert-send.ts`, `telegram.ts`). | No step advancement, no draft-PR checkpoint, no ready-for-review transition, no end-of-run PR review request message. |
| Tasks assigned to new/existing board; custom lanes or template | Boards are per project (`lib/storyboard/service.ts`, `templates.ts`, `lanes.ts`); custom-lane boards are files in the notes `storyboard/` folder. `NewBoardDialog.tsx` is landing. Task creation (`components/notes/CreateTasksFromDialog.tsx`, task forms) has no board field. | Board picker at task creation; task-to-board link. |
| AI decides what goes where: decisions, waypoints, POI, screenshots | Cards are projected from tasks, runs, PRs, QA (`lib/storyboard/projection.ts`, `sources.ts`, `orchestration-projection.ts`, `lib/qa/storyboard.ts`). `captureEvidence` (service.ts:280) is the manual "pin" path. MCP server lives at `mcp-servers/devhub-server/src/` with no storyboard tool. | No agent-facing post tool; no decision/waypoint/POI card kinds; no prompt guidance. |
| Jev demo + bugs at review; before/after video | QA runs from the QA page only (`lib/qa/service.ts`); desktop runs produce `run.mp4` tagged `phase: "after"` (`lib/qa/desktop.ts:80`). Automatic QA after build is in progress. | No automatic review demo, no "before" capture, no bug cards. |
| Visual, static-timeline Miro | `ProjectBoard.tsx` lanes + `EvidenceCard.tsx`; `SessionTimeline.tsx` separate. | Board is dense and report-oriented. |
| Less going on | Every card exposes choose/reject/accept/move/pin (`service.ts:225-250`; `Selection` in `types.ts:107`). | Curation controls should leave the default view. |

**What "pinned" does today:** pinning captures a session-timeline event (a run event) as a board card via `captureEvidence`. It is idempotent by source identity (`adapter` + `runId:eventId`), so pinning twice returns the same card, and an orchestrator highlight of the same event is the same card. It is "save this moment to the board", not "stick to top".


## 2. Phase 1: Auto mode end to end


```
starting → planning → implementing ⇄ checking (tests/CI, fix loop, max K)
  → draft-pr (gh pr create --draft)
  → awaiting-feedback (needs-you; questions + Jev demo/bugs shown)
      ├─ feedback → implementing (same branch)
      └─ approve  → ready-for-review (gh pr ready) → show copy-paste PR review request message → done
any → paused-manual | needs-you (blocking question) | stopped
```
- Extends `ORCHESTRATION_STATUSES` (keep old values; map `pr-created` to `draft-pr`).
- Auto grants commit/push consent for the orchestration's branch only (via `lib/agent-runs/consent.ts`); merge, force-push and pushing to main stay blocked.
- Step advancement is a tick driven by run completion events (`lib/agent-runs/events.ts`) and the existing PR watch tick.
- **Slack is out of scope (John, 16 Oct).** The final step shows the existing copy-paste PR review request message for John to send himself. Feedback and answers happen in DevHub (Questions section, PR comments picked up by PR watch).


Answering questions: a "Questions" section in the task note (see Phase 4) plus the orchestrator status panel (`app/storyboard/OrchestratorStatus.tsx`); answers resume the run.

## 3. Phase 2: Jev QA at review


- **Before:** if enabled, at `starting` run a Jev demo script on the unchanged checkout (task's acceptance path) and store the video with `phase: "before"`.
- **After:** at `draft-pr` run Jev QA (the in-progress auto-QA work) on the branch with the same script; store `phase: "after"` video and screenshots (existing `desktop.ts` ffmpeg path).
- **Bugs:** QA findings become Bug cards in a "Review" lane; blocking bugs push the state back to implementing before notifying John (once, then ask).
- Video card shows before/after side by side. Skip with a recorded reason when there's no runnable UI.


**Stashed WIP (`stash@{0}` "dropped auto-jev-qa WIP", 8 files, +377):** reusable as the base. It adds `prepareTaskQaRun`, `buildTaskQaScenario` (scenario from title, description, acceptance and preview URL in the note) and `taskQaTargetUrl` in `lib/qa/service.ts`, an idempotent request id per task+run, a "claim completed implementation once, then run Jev" step in `lib/storyboard/orchestrator.ts`, and a visible "QA skipped: no runnable app or preview URL" reason in `OrchestratorStatus.tsx`, all with tests. Missing: before capture, bug extraction to the note, and the feedback loop. Plan: restore it onto current main as the first Phase 2 commit, rerun its tests, then add the rest. Its hook should fire on `draft-pr`, not straight after implement.

## 4. Phase 3: model sets and Jev routing


- **Decision points:** plan, implement (per sub-step), fix-after-CI/review failure, review, QA/demo, summarise-for-card.
- **Tiers:** the saved set maps fixed tiers **cheap / mid / heavy** (decided by John) to provider+model+effort, each set with the existing model and effort pickers. QA keeps its own Jev setting. Jev picks one tier per step.
- **How it picks:** a cheap Jev call (QA decision model, `lib/qa/models.ts`) gets a compact context (step, diff size, files touched, failures so far, plan risk from the existing risk heuristic) and returns `{tier, reason}`. Rules as guard rails: plan defaults mid; >N files or repeated failure escalates to heavy; summaries and card writing always cheap; QA uses QA tier. If Jev errors, fall back to rules.
- **Recorded:** each choice becomes a Decision card ("Used heavy for implement: 14 files, 2 failed checks") and a usage line on the Receipt (`lib/storyboard/usage.ts`).
- **Saved defaults:** new `routing` settings (per user, optional per board override) stored with other DevHub settings, not localStorage, so Auto runs on the server can read them. The launch sheet seeds from them; the existing localStorage memory stays for manual one-offs.
- Dispatch passes `model`/`effort` through the existing `dispatchAgentRun` fields.


## 5. Phase 4: visual task notes (instead of lanes-first)

The task note becomes the at-a-glance surface for both John and agents. Notes already exist per task (`lib/tasks/task-notes.ts`, `resolveTaskNotePath`) and are read into prompts (`lib/tasks/implement-ready-gather.ts`).

**Standard sections** (agents create and keep them tidy): Summary (3 lines, always current), Status (step, PR link, next action), Questions for John, Decisions (choice, why, alternatives), Screenshots and video (before/after, captioned), Bugs (from Jev; severity blocker/high/medium/low, with blocking/major/minor accepted as aliases), Waypoints (done steps), Points of interest (files and risks), Log (collapsed, append-only).

**Rendering:** a note view with a header card (status, PR, cost), a media grid for screenshots and video, decision cards, callouts for questions and blocking bugs, better typography and spacing. Plain markdown underneath, so it stays editable and diffable.

**Agents maintain it:** an MCP tool `task_note_update` (in `mcp-servers/devhub-server/src/tools/`) with section-level operations (replace Summary, add Decision, attach screenshot, resolve Question) so agents refactor sections instead of appending. Task and run come from the run's token. A prompt block in `lib/tasks/implement-prompt.ts` says: update Summary/Status at each step, record decisions, add screenshots after UI changes, ask in Questions instead of guessing, prune stale content. The orchestrator also writes Status itself at each state change so the note is correct even if an agent forgets.


- **(Superseded by `task_note_update`; kept for reference) MCP tool** `storyboard_post` in `mcp-servers/devhub-server/src/tools/`: `{ kind: summary|decision|waypoint|poi|screenshot|question|note, title, body, files?, imagePath?, laneHint? }`. Task/run/board are inferred from the run's env token, never passed by the agent.
- **HTTP** `POST /api/storyboard/cards` behind the same service (`captureEvidence` generalised), for non-MCP runtimes.
- Lane placement: `laneHint` if valid, else `laneForKind` from the template, so the AI "decides" within the board's lanes.
- Dedupe by `runId:clientId`; rate limit per run (e.g. 30 cards) to stop noise.
- Prompt: add a short "Storyboard" block to `lib/tasks/implement-prompt.ts` when a board is linked: post a Decision when choosing between approaches, a Waypoint at each plan step done, POI for risky code, Screenshot after UI changes, Question instead of guessing. Keep to under 10 cards per step.


## 6. What happens to Storyboard lanes

Recommendation: **shrink, don't retire yet.** Make the board a read-only view over task notes and runs: one card per task section (decisions, media, bugs) laid out by time. Keep custom boards and templates (just landed in `e49ad6b36`) for grouping tasks. Move chosen/suggested/rejected, move and pin into a "Build report" mode, since the stakeholder report and receipt are still useful. Retire later if nobody opens the board once notes are visual.

**What "pinned" does today:** pinning captures a session-timeline event as a board card via `captureEvidence` (`lib/storyboard/service.ts:280`). It is idempotent by source identity (`adapter` + `runId:eventId`), so pinning twice gives the same card. It means "save this moment", not "stick to top".

## 7. Milestones

**M1 Auto to draft PR.** State machine, branch-scoped consent, draft PR, questions/feedback checkpoint, `gh pr ready`, copy-paste review request message. *Accept:* on a test repo, one Auto run ends at a draft PR, takes a feedback round, goes ready for review and shows the review request message; never touches main.

**M2 Jev QA at review.** Restore the stash, trigger on `draft-pr`, before/after video, bugs into the note, blocking bugs loop back once. *Accept:* a UI task shows both videos and any bugs before John is notified; non-UI tasks show a skip reason.

**M3 Model sets.** Saved routing settings, launch sheet tiers with the existing pickers, Jev router with rule fallback, choices recorded. *Accept:* Auto uses the saved set; each step shows its model and reason; router failure falls back.

**M4 Visual notes.** Section schema, `task_note_update` tool, prompt block, orchestrator Status writes, new note rendering. *Accept:* after a run the note has a current Summary, decisions, captioned screenshots and no duplicated sections.

**M5 Board as a view.** Board reads from notes; curation behind Build report. *Accept:* default board has no choose/reject/pin; report output is unchanged.

## 8. Risks

- Auto pushing code: consent limited to the orchestration branch; never main, never force.
- Agents rewriting notes badly: section-level operations only, John's own text in protected sections, note history in git.
- Router cost/latency: router call on the cheapest tier, cached per step.
- Before demos flaky when main doesn't start: time-box and skip with a reason.
- Stash drift: it predates the New board commit, so expect conflicts in `orchestrator.ts`.

## 9. Open questions

Resolved: Slack is out of scope (copy-paste review message instead); tiers are fixed cheap/mid/heavy.

1. Who is the reviewer when the PR goes ready, and branch naming?
2. Which note sections are John-only and must never be edited by agents?
3. Retire the Session timeline view, or fold it into the note Log?
