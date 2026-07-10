---
---

name: devhub-recap
description: Use when the user asks for a recap of the current, latest, or named OpenCode session, including commands, MCP calls, file changes, failures, and mutations without prompts or reasoning.
metadata:
short-description: Recap OpenCode session activity

---

# DevHub Recap

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
