---
name: devhub-create-tasks-from
description: >-
  Turn a DevHub planning note into linked Jira sub-tasks, DevHub tasks, and
  entity cross-links — publish the plan gist, create tickets under a parent epic,
  scaffold task notes, and update the parent Jira description. Use when the user
  launches "Create tasks from" on a note or asks to materialize a plan into
  tickets and tasks.
metadata:
  short-description: Plan note → Jira + DevHub tasks
---

# Create Tasks From Plan

## Overview

Materialize an implementation-plan note into trackable work:

1. Publish the plan for a stable gist URL (`share_publish`).
2. Create Jira tickets (sub-tasks under a parent, or parent + sub-tasks when none exists).
3. Create one DevHub task per work item with links to the note, gist, repo(s), and Jira key.
4. Link everything back: plan note `## Links`, parent Jira description, task notes.

Default outcome: every PR slice in the plan has a Jira sub-task, a DevHub task, and
bidirectional links — the same graph a human would wire by hand.

## When To Use

- Dashboard **Create tasks from** on a planning note (curl the plan URL first).
- User asks to turn a plan note into Jira tickets and DevHub tasks.
- Multi-repo plans with `PR N — <repo>:` style sections.

## Inputs

The launch prompt includes a **plan URL**. Curl it before doing anything else:

```bash
curl -sf '<plan-url>'
```

Payload fields:

| Field | Meaning |
| --- | --- |
| `notePath` | Vault-relative note path (no extension) |
| `title` | Note title from first heading |
| `markdown` | Plan body as markdown |
| `workItems` | Parsed PR/work slices (`id`, `title`, `summary`, `repoHint`, `description`) |
| `repos` | Repo EntityRef ids from the note + dialog overrides |
| `parentKey` | Optional parent Jira key (epic/story); omit to create a parent |
| `projectKey` | Jira project (default `PTF`) |
| `epicSummary` | Parent ticket summary when creating a new parent |
| `tags` | `#tags` from the note body |
| `jiraMeta` | Sprint/team hints when Jira is configured (for parent tickets only) |

If `workItems` is empty, re-read the note (`notes_read`) and derive slices from
`PR <n> —` headings or level-2 sections that describe deliverable PRs. Ask once if
ambiguous.

## Workflow

### 0. Confirm scope

- If zero work items after parsing, stop and ask how to slice the plan.
- If multiple repos and items lack `repoHint`, ask which repo each item targets.
- Do not create duplicate Jira keys or tasks for items that already have links in
  the note `## Links` section — read `entity_links_read` first.

### 1. Publish the plan

```text
share_publish { vault: "notes", path: "<notePath>" }
```

Keep the returned gist URL — every ticket description and parent rollup links it.

### 2. Resolve or create the Jira parent

**When `parentKey` is set:** `getJiraIssue` to confirm it exists. Sub-tasks will be
created under this parent (or under the creation parent per BI Jira hierarchy — see
`creationParentForLinkedIssue` behaviour in the dashboard: Tasks parent to Stories).

**When `parentKey` is missing:** create a parent ticket first:

- **Type:** Story (or Task if Story is unavailable in the project).
- **Summary:** `epicSummary` from the plan payload, or the note title.
- **Description:** One paragraph from the plan intro + link to the gist + link to the
  DevHub note (`/notes/<notePath>`).
- **Sprint / team:** Set only on the **parent**, not on sub-tasks. Use `jiraMeta` from
  the plan payload when present. Do not invent custom field ids — prefer Atlassian MCP
  `createJiraIssue` with `additional_fields` only when the dashboard meta is missing.

**BI Jira defaults** (Business Insider cloud):

- `cloudId`: `750c6c09-b462-4997-8c11-c3441ac402ac`
- Assignee John McElreavey: `712020:3fff01cc-7973-4f7c-8d5f-7860247941d8` (only when
  the user explicitly chose that assignee; otherwise assign to the authenticated user
  or leave unset per project rules).

### 3. Create Jira sub-tasks (one per work item)

Use Atlassian MCP `createJiraIssue` when available; otherwise `POST /api/jira/issue`
on the DevHub dashboard (`DEVHUB_BASE_URL`).

For each `workItems[]` entry:

- **Type:** Sub-task (when parent exists) — issuetype name `Sub-task`.
- **Summary:** `summary` or a trimmed `title` (≤255 chars).
- **Description:** Item `description` or section body + links:
  - Plan gist (from step 1)
  - DevHub note path
  - Repo(s) involved
- **Parent:** the resolved parent key from step 2.

**Sub-task rules (learned the hard way):**

- Do **not** set sprint (`customfield_10102`) or team (`customfield_12800`) on
  sub-tasks — they inherit sprint and team from the parent.
- Sub-tasks inherit Foxes team and active sprint from the parent automatically.

Record each created key as you go.

### 4. Create DevHub tasks

For each work item + Jira key:

```text
tasks_create {
  text: "<JIRA-KEY>: <short summary>",
  withNote: true,
  links: [
    { kind: "note", id: "<notePath>", label: "<title>" },
    { kind: "jira", id: "<JIRA-KEY>", label: "<JIRA-KEY>" },
    { kind: "repo", id: "<owner/repo or folder>", label: "<repo>" }
  ]
}
```

- Reuse `tags_list` / canonical tags from the plan (`tags` field); add stable
  workstream tags (`#bi-job-scout`), not ticket-id tags.
- After creation, `tasks_update` or `tasks_context_sync` to add the gist URL as a
  link if there is no `gist` EntityKind — append to the task note `## Links` instead:
  `Plan: <gist url>`.

### 5. Link the plan note

Read the note (`notes_read`), then merge into `## Links`:

- Each Jira sub-task (`jira` EntityRef)
- Each DevHub task (`task` EntityRef with Work href)
- Each repo (`repo` EntityRef)
- The parent Jira ticket

Use `notes_write` only when you can preserve BlockNote content safely; prefer
`notes_append` for a `## Links` block if the note is large/rich and you are only
adding links. Never drop plan prose.

### 6. Update parent Jira description

`editJiraIssue` on the parent (Atlassian MCP) or dashboard API:

- Add a **Plan** link (gist).
- Add a **DevHub** link to the note.
- List sub-task keys with one-line summaries.

Append; do not replace existing description content.

### 7. Report back

Return a compact table: work item → Jira key → DevHub task id → repo.
Include the gist URL and parent key.

## MCP tool map

| Step | Tool |
| --- | --- |
| Read plan payload | curl plan URL from launch prompt |
| Read / update note | `notes_read`, `notes_append`, `notes_write`, `entity_links_read` |
| Publish gist | `share_publish` |
| Create Jira | `createJiraIssue` (Atlassian MCP) or `POST /api/jira/issue` |
| Update Jira parent | `editJiraIssue` (Atlassian MCP) |
| Create tasks | `tasks_create`, `tasks_context_sync` |
| Tags | `tags_list`, `tags_lookup` |
| Repos | `repos_list` to resolve local folder names |

## Verification

- `entity_links_read` on the plan note shows new Jira and task refs.
- Each DevHub task opens with correct links and a task note.
- Parent Jira ticket lists sub-tasks and the gist.
- No duplicate tickets for the same PR section.

## Rules

- Ask before creating a **new** parent epic if the note already links a Jira parent.
- Never log CVs, credentials, or full plan bodies in terminal output.
- No AI attribution in Jira descriptions, task text, or commits.
- Minimal scope: create and link tickets — do not start implementation.
