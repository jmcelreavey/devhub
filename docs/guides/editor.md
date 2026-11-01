---
title: Editor and selection chat
description: Discuss captured code beside a diff, or pair an installed editor.
order: 27
icon: SquareTerminal
tags: [repos, agents]
related:
  - guides/task-checks-and-reviews
  - architecture/mcp-server
---

# Editor and selection chat

In **Repos → Changes**, select lines and choose **Send to AI**. DevHub opens a side panel with the exact selection, its diff revision and staged/unstaged source. Choose a task and an assistant, or continue an idle conversation from that checkout. Sending keeps the diff open and creates no extra worktree. `/editor` is not a sidebar row; **Open editor** from Changes takes you to the pairing controls.

The default request asks for an explanation. This is an instruction, not a permissions boundary: the assistant retains its existing local access. Discussion runs stay linked to their task without replacing its implementation Resume target.

![Reviewing captured code and choosing a conversation in Ask AI](../assets/demos/editor-ask-ai.gif)

*Real selection panel with invented code, tasks and assistant choices. The clip doesn't send code to a model.*

Selections are limited to 12,000 characters; questions to 8,000. The submitted request keeps a stable request ID, so a retry of that request doesn't start a second discussion. Existing conversations must be idle and belong to the same checkout; their original task link stays fixed.

## Cursor or VS Code

The optional add-on lives in `extensions/devhub-selection`. Build it with `npm ci && npm run build` in that directory, then package with `vsce package` and install the VSIX. It uses the public VS Code extension API, not Cursor's private chat API. Selection commands work in Restricted Mode: the add-on reads the chosen buffer and never executes workspace code. Nothing is published to a marketplace by DevHub.

1. Open **Editor** (`/editor`, from Changes) and choose the matching repository.
2. Create a pairing code and copy it.
3. In the editor, run **DevHub: Pair this Workspace** and paste the code.
4. Select code and run **DevHub: Ask AI about Selection**.
5. Review the captured text in DevHub before sending. Installed editors open a preview link.

Pairing expires after 30 minutes or a dashboard restart and is limited to one workspace. A new code replaces the old one and clears its pending previews. **Revoke pairing** also clears pending selections. The editor stores its credential in SecretStorage; it never receives the dashboard's global credential. Pending selections expire after 10 minutes or when the dashboard process stops. Unsaved text is labelled and is not replaced with disk contents.

For WSL, install the add-on in the workspace's WSL extension host. Real paths must match; Windows paths are not silently translated.

## From an agent

Use `editor_selection` to read a paired-editor preview or pending workspace selection, and `editor_discussions` to inspect same-checkout conversation choices for that snapshot. After the human reviews the exact code, question and provider, `editor_discuss` requires `confirm: true` and a stable `requestId`. These tools cannot pair an editor or grant filesystem access. See [MCP server](../architecture/mcp-server.md#discuss-an-editor-selection).

See [VS Code's extension allowlist](https://code.visualstudio.com/docs/enterprise/extensions), and [remote extension placement](https://code.visualstudio.com/api/advanced-topics/remote-extensions).
