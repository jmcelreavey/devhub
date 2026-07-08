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
