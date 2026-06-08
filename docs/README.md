# DevHub Documentation

DevHub is a local-first workspace for managing AI coding tools, notes, tasks, integrations, and shared agent configuration.

These docs are written for day-to-day users and future contributors. They explain how the system works at a stable concept level, avoiding fragile implementation details that are likely to change.

## Start Here

| Page                                            | Use It For                                          |
| ----------------------------------------------- | --------------------------------------------------- |
| [Installation](getting-started/installation.md) | Installing dependencies and starting DevHub         |
| [Setup](getting-started/setup.md)               | Configuring paths, network access, and integrations |
| [Electron App](getting-started/electron-app.md) | Using the optional desktop launcher                 |

## Architecture

| Page                                                 | Use It For                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Overview](architecture/overview.md)                 | Understanding the main parts of DevHub                                       |
| [Dashboard](architecture/dashboard.md)               | How the web dashboard is organized                                           |
| [Sync Engine](architecture/sync-engine.md)           | How skills, persona, agents, and MCP configs move between the repo and tools |
| [MCP Server](architecture/mcp-server.md)             | How notes, tasks, and diagrams are exposed to AI tools                       |
| [Notes System](architecture/notes-system.md)         | Note areas, master checklists, optional in-editor AI                         |
| [Persona System](architecture/persona-system.md)     | How shared AI behavior is layered                                            |
| [Electron Wrapper](architecture/electron-wrapper.md) | How the desktop app launches and manages DevHub                              |

## Integrations

| Page                                                   | Use It For                                        |
| ------------------------------------------------------ | ------------------------------------------------- |
| [Google Calendar](integrations/google-calendar.md)     | Calendar setup and usage                          |
| [Jira](integrations/jira.md)                           | Jira Cloud setup and ticket views                 |
| [Datadog](integrations/datadog.md)                     | Alert links and event summaries                   |
| [GitHub](integrations/github.md)                       | Pull request tracking and standup support         |
| [BI Infrastructure](integrations/bi-infrastructure.md) | Internal operations helpers and service discovery |

## Guides

| Page                                         | Use It For                                      |
| -------------------------------------------- | ----------------------------------------------- |
| [Skills](guides/skills.md)                   | Creating, syncing, and collecting shared skills |
| [Shared Agents](guides/agents.md)            | Subagent catalog, sync, and collect from local tools |
| [OpenCode and OpenChamber](guides/opencode-and-chamber.md) | Local ports, shared OpenCode, config sync, 1Password |
| [Sharing](guides/sharing.md)                 | Temporary note/doc links via secret GitHub Gists |
| [Command Palette](guides/command-palette.md) | Keyboard shortcuts and fast navigation          |
| [Scheduled Jobs](guides/scheduled-jobs.md)   | Running safe maintenance actions on a schedule  |
| [Standup](guides/standup.md)                 | Generating daily standup notes                  |
| [PWA](guides/pwa.md)                         | Installing DevHub as a browser app              |
| [Theming](guides/theming.md)                 | Choosing and customizing the look of DevHub     |

## Reference

| Page                                                        | Use It For                                        |
| ----------------------------------------------------------- | ------------------------------------------------- |
| [API Routes](reference/api-routes.md)                       | High-level API surface reference                  |
| [Environment Variables](reference/environment-variables.md) | Configuration variable reference                  |
| [Scripts](reference/scripts.md)                             | CLI and lifecycle scripts                         |
| [Platform Requirements](PLATFORM_REQUIREMENTS.md)           | Supported platforms and capabilities              |
| [Memory Options](MEMORY_OPTIONS.md)                         | Why DevHub uses git-backed notes                  |
| [Token Budget](TOKEN_BUDGET.md)                             | How persona and memory stay lightweight           |
| [Migration](MIGRATION.md)                                   | Moving from older DevHub versions                 |
| [Backlog](reference/backlog.md)                             | Condensed quality backlog and future improvements |
