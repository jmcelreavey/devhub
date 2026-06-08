# Standup

DevHub can generate a Markdown standup summary from local work signals.

## Inputs

Depending on your setup, standup can include:

- Git commit subjects.
- Jira activity.
- GitHub pull requests.
- Tasks due today.
- Daily note context.

## Typical Use

1. Open Today.
2. Review tasks, notes, tickets, and PRs.
3. Open the standup preview.
4. Copy the generated Markdown.
5. Edit before posting if needed.

## Good Standup Hygiene

- Treat generated text as a draft.
- Remove noisy or irrelevant details.
- Add context that tools cannot infer.
- Keep the final message human-readable.

## Troubleshooting

| Problem                  | Check                                         |
| ------------------------ | --------------------------------------------- |
| Git work is missing      | Repo root points to the expected checkout     |
| Jira updates are missing | Jira integration is configured                |
| PRs are missing          | GitHub CLI is authenticated                   |
| Output is too noisy      | Narrow the time window or edit before sharing |
