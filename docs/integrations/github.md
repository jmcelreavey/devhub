# GitHub

DevHub uses GitHub data for pull request tracking, repo awareness, and standup generation.

## What It Enables

- Open pull requests you authored.
- Pull requests waiting for your review.
- Recently merged PRs for standup notes.
- Repo discovery and quick actions.

## Recommended Setup

Install and authenticate the GitHub CLI:

```bash
gh auth login
```

DevHub can then use your existing local GitHub authentication instead of storing a separate token.

## Temporary Note And Doc Sharing

When GitHub is configured, DevHub can publish notes and docs as **secret gists** — unlisted links for short handoffs. Requires the same `gh auth login` session.

- Publish from the **Share** control in the notes/docs editor.
- Manage active links on **Live links** (`/shared`).
- Links auto-expire after 14 days.

See [Sharing](../guides/sharing.md) for the full workflow, security model, and troubleshooting.

## Pull Request Views

The PR views are meant to answer:

- What do I need to review?
- What do I have open?
- What recently merged work should appear in standup?

## Standup Support

GitHub activity can contribute to standup markdown, especially merged PRs and review activity.

## Troubleshooting

| Problem            | Check                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| PRs do not load    | `gh auth status` succeeds                                                  |
| Repo is missing    | It has a GitHub remote and is discoverable from DevHub's repo search scope |
| Standup misses PRs | The PR was merged in the selected time window                              |
