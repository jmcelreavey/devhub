# Jira

The Jira integration brings assigned tickets into DevHub and improves standup generation.

## What It Enables

- Ticket list and status filters.
- Today widget for assigned work.
- Links from Jira keys in tasks.
- Standup content based on recent ticket activity.

## Setup

Configure Jira from `/setup`.

| Setting        | Purpose                                       |
| -------------- | --------------------------------------------- |
| Jira domain    | Your Atlassian Cloud domain                   |
| Jira email     | Account email used for API access             |
| Jira API token | Token created from Atlassian account settings |

## Jira Keys In Tasks

When a task contains a key such as `DAD-1234`, DevHub can treat it as a Jira reference.

This helps with linking and standup generation.

## Create Tickets From Tasks

Each task row has an **Add to Jira** action (Jira icon) when Jira is configured. It opens a confirmation modal that:

- Seeds the summary from task text (strips an existing linked key if present).
- Lets you pick a parent: the task's linked ticket, another key, or none.
- Resolves the project from the parent key prefix (or `JIRA_DEFAULT_PROJECT` when there is no parent).
- Shows board, active sprint, assignee, and inherited **Team** from `GET /api/jira/meta` (pass `reference=<parentKey>` to inherit Team from the parent).
- Optionally adds the issue to the active sprint.
- Creates a **Task** or **Sub-task** (when a parent is set) via `POST /api/jira/issue`, assigns to you by default, and rewrites the task text with the new key.

| Route | Purpose |
| ----- | ------- |
| `GET /api/jira/meta?project=<KEY>&reference=<parentKey>?` | Board, sprint, Team field ids/values, and assignee for the modal |
| `POST /api/jira/issue` | Body: `{ projectKey, summary, description?, parentKey?, issuetypeName?, assignToMe?, sprintId? }` — returns `{ key, url }` (`201`) |

## Workflow Transitions

When you complete or abandon a task that includes a Jira key, DevHub can prompt you to move the ticket to a new workflow state.

| Route | Purpose |
| ----- | ------- |
| `GET /api/jira/ticket/<key>/transitions` | Lists available transitions for the ticket |
| `POST /api/jira/ticket/<key>/transition` | Body: `{ transitionId }` — applies the transition |

The prompt is optional — you can dismiss it without changing Jira. Agents can use the MCP tool `jira_ticket_transition` for the same operation (see [MCP Server](../architecture/mcp-server.md)).

## Usage Tips

- Keep task text clear even when it includes a ticket key.
- Use Jira for source-of-truth ticket status.
- Use DevHub tasks for personal daily execution.

## Troubleshooting

| Problem                         | Check                                             |
| ------------------------------- | ------------------------------------------------- |
| Tickets are missing             | Jira credentials and domain are correct           |
| Links go to the wrong Jira site | Public Jira domain setting matches your workspace |
| API errors                      | The token has not expired or been revoked         |
