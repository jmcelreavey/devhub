---
name: devhub-create-tasks-from
description: Split a DevHub planning note into linked Jira sub-tasks and DevHub tasks. Use when asked to create tasks or sub-tasks from a plan or note.
metadata:
  short-description: Plan note → Jira + DevHub tasks
---

# Create Tasks From Plan

## Overview

Before drafting ticket titles/descriptions, DevHub tasks, or task-note prose, load
`my-voice` in `full-voice` mode and its writing style guide. Keep reported facts,
reproduction details, links, and identifiers exact; do not invent findings.

Materialize an implementation-plan note into trackable work:

1. Publish the plan for a stable gist URL (`share_publish`).
2. Create Jira tickets (sub-tasks under a parent, or parent + sub-tasks when none exists).
3. Create one DevHub task per work item with links to the note, gist, repo(s), and Jira key.
4. Link everything back: plan note `## Links`, parent Jira description, task notes.

Default outcome: every work item in the note has a Jira sub-task, a DevHub task, and
bidirectional links — the same graph a human would wire by hand.

## When To Use

- Dashboard **Create tasks from** on a planning note (curl the plan URL first).
- User asks to turn a plan note into Jira tickets and DevHub tasks.
- Issue lists, unchecked checklists, and multi-repo plans with `PR N — <repo>:` sections.

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
| `workItems` | Parsed PR/work slices (`id`, `title`, `summary`, `repoHint`, `description`, optional `images`) |
| `repos` | Repo EntityRef ids from the note + dialog overrides |
| `parentKey` | Optional parent Jira key (epic/story); omit to create a parent |
| `projectKey` | Jira project (from the selected Jira project) |
| `epicSummary` | Parent ticket summary when creating a new parent |
| `jiraMeta` | Sprint/team hints when Jira is configured (for parent tickets only) |

The launch prompt may include user instructions for the parent title and grouping;
use those when deciding how to create tickets. List entries are work items too —
PR headings are not required. Skip empty or completed checklist entries and note links.

If the launch prompt includes **reviewed work items**, use that list instead of
`workItems` from the plan URL. The user has already edited the titles and removed
unwanted items. Use each reviewed `summary` exactly as the ticket title; keep its
source description and repo hint. Do not restore omitted items or rewrite approved
titles. If the reviewed list is empty, stop without publishing or creating anything.

Only when no reviewed list was supplied and `workItems` is empty, re-read the note
(`notes_read`) and derive work items from the user instructions, issue bullets,
checklists, or deliverable sections. Ask once if the scope is still ambiguous.

## Workflow

### 0. Confirm scope

Prefer a vertical slice: a narrow path through the layers that someone can demo or verify on its own. Record what it is blocked by (other items, or nothing). If the current code is in the way, the first slice is the prefactor: make the change easy, then make the easy change. A wide mechanical change (a rename or retype that fans across every caller) is not one slice. Sequence it as add the new form, migrate callers in batches that stay green, then delete the old form once nothing calls it. Show the breakdown and the blocking edges before you publish, and change them if the user says the granularity is wrong. Adapted from Matt Pocock's `to-tickets` skill (MIT).

- If no work items can be derived from the note and user instructions, ask how to slice it.
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
created under this parent (or under the creation parent per project Jira hierarchy — see
`creationParentForLinkedIssue` behaviour in the dashboard: Tasks parent to Stories).

**When `parentKey` is missing:** create a parent ticket first:

- **Type:** Story (or Task if Story is unavailable in the project).
- **Summary:** `epicSummary` from the plan payload, or the note title.
- **Description:** One paragraph from the plan intro + link to the published plan gist.
- **Sprint / team:** Set only on the **parent**, not on sub-tasks. Use `jiraMeta` from
  the plan payload when present. Do not invent custom field ids — prefer Atlassian MCP
  `createJiraIssue` with `additional_fields` only when the dashboard meta is missing.

**Jira site and assignee:**

- `cloudId`: resolve with Atlassian MCP `getAccessibleAtlassianResources`; never hardcode it here.
- Assignee: the authenticated user, or unset per project rules. Only assign someone else when
  the user names them — look up their account id with `lookupJiraAccountId`.

### 3. Create Jira sub-tasks (one per work item)

Use Atlassian MCP `createJiraIssue` when available and authenticated. Otherwise use
DevHub `integrations_propose` with `issue.create`. A proposal is not a created
ticket: a person must confirm it in Integrations. Never invent a child key or use
the parent's key in its place.

For each `workItems[]` entry:

- **Type:** Sub-task (when parent exists) — issuetype name `Sub-task`.
- **Summary:** `summary` or a trimmed `title` (≤255 chars).
- **Description:** Item `description` or section body + links:
  - Plan gist (from step 1)
  - Repo(s) involved
- **Parent:** the resolved parent key from step 2.

**Sub-task rules (learned the hard way):**

- Do **not** set sprint (`customfield_10102`) or team (`customfield_12800`) on
  sub-tasks — they inherit sprint and team from the parent.
- Sub-tasks inherit Foxes team and active sprint from the parent automatically.

Record each returned child key as you go. If creation is pending, follow the
pending-proposal path in step 4 instead.

### 4. Create DevHub tasks

When Jira has returned the work item's own child key:

```text
tasks_create {
  text: "<JIRA-KEY>: <short summary>",
  withNote: true,
  parentKey: "<PARENT-KEY>",
  links: [
    { kind: "note", id: "<notePath>", label: "<title>" },
    { kind: "jira", id: "<JIRA-KEY>", label: "<JIRA-KEY>" },
    { kind: "repo", id: "<owner/repo or folder>", label: "<repo>" }
  ]
}
```

When Jira keys are not available yet:

1. Create the DevHub task first with `text: "<short summary>"`, `withNote: true`
   and `parentKey: "<PARENT-KEY>"`. Do not prefix the summary with any Jira key.
   Link the source note and repo as usual; the parent may be a context link
   labelled `Parent <PARENT-KEY>`, never the task's own ticket.
2. Pass the returned task id to `integrations_propose`:

   ```text
   integrations_propose { input: {
     action: "issue.create", provider: "jira", account: "default",
     projectKey: "<PROJECT>", parentKey: "<PARENT-KEY>",
     taskId: "<DEVHUB-TASK-ID>", title: "<short summary>", body: "<description>"
   } }
   ```

3. Report the proposal as awaiting confirmation. On success, DevHub writes the
   returned child key into that same task's text and Jira link. Do not create a
   replacement task, guess a key, or copy the parent's status onto the task.

Omit `parentKey` when there is no confirmed parent yet. If creating the parent
itself needs confirmation, stop at that proposal and wait for its real key before
proposing children. A pending proposal id is not a Jira key.

- Work items can carry nested content and screenshots (toggle lists with images). Right
  after `tasks_create`, `notes_append` the item's `description` markdown to the task note
  unchanged, including its `![](…)` image lines. Images are `/api/notes-media/…` or
  notes-relative asset paths, shared by every note, so they render in the task view
  without copying files. Do not rewrite or drop those lines.
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

`editJiraIssue` on the parent (authenticated Atlassian MCP):

- Add a **Plan** link (gist).
- List sub-task keys with one-line summaries.

Append; do not replace existing description content. If Atlassian is unavailable,
report this follow-up rather than bypassing confirmation or sending unsupported
proposal actions. Only list confirmed child keys; pending proposals stay pending.

### 7. Report back

Return a compact table: work item → Jira key → DevHub task id → repo.
Include the gist URL and parent key.

## MCP tool map

| Step | Tool |
| --- | --- |
| Read plan payload | curl plan URL from launch prompt |
| Read / update note | `notes_read`, `notes_append`, `notes_write`, `entity_links_read` |
| Publish gist | `share_publish` |
| Create Jira | `createJiraIssue` (authenticated Atlassian MCP) or `integrations_propose` (`issue.create`, with `taskId`) |
| Update Jira parent | `editJiraIssue` (Atlassian MCP) |
| Create tasks | `tasks_create`, `tasks_context_sync` |
| Repos | `repos_list` to resolve local folder names |

## Verification

- `entity_links_read` on the plan note shows new Jira and task refs.
- Each DevHub task opens with correct links and a task note.
- Parent Jira ticket lists sub-tasks and the gist.
- No duplicate tickets for the same work item.
- Pending proposals have a keyless DevHub task and its `taskId`; parent keys are context only.

## Rules

- Ask before creating a **new** parent epic if the note already links a Jira parent.
- Never log CVs, credentials, or full plan bodies in terminal output.
- Jira titles and descriptions must make sense to colleagues who don't use DevHub:
  do not mention DevHub, local note paths or dashboard URLs. Use the published plan
  gist and relevant repository links; keep DevHub links in DevHub tasks and notes.
- No AI attribution in Jira descriptions, task text, or commits.
- Minimal scope: create and link tickets — do not start implementation.
