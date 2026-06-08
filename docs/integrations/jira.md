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
