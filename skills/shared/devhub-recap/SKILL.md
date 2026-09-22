---
name: devhub-recap
description: Recap the commands, changes, failures, and mutations in an OpenCode session. Use when working in OpenCode and the user asks for a recap of the session or to capture the work — sessions_recap can only see OpenCode sessions.
metadata:
  short-description: Recap OpenCode session activity
---

# DevHub Recap

## Only for OpenCode

`sessions_recap` reads the OpenCode HTTP API. From Claude Code, Cursor, Codex or
any other harness it cannot see the current session — it would return the latest
*unrelated* OpenCode session in this directory. Outside OpenCode, don't call it:
recap from your own tool history instead (commands run, files changed, failures,
anything that mutated remote state), in the same terse shape.

## Workflow

1. Call `sessions_recap` with the current workspace `directory`. Include `sessionId` when the user names one; otherwise DevHub selects the current busy root, then the latest root in that directory.
2. Set `includeChildren: true` only when the user asks for child or subagent sessions.
3. Return the tool result unchanged. Do not add prompts, reasoning, summaries, or explanatory prose.
4. Save the result with the DevHub notes tools only when the user explicitly asks to save it. Use the note path they provide, or ask for one short path clarification.

## Rules

- The OpenCode HTTP API is the source of truth; do not reconstruct activity from chat history or local session files.
- Keep recursively redacted values redacted.
- If multiple root sessions are busy, ask for a session id.
- If OpenCode is unavailable, report that failure without guessing.
