import { describe, expect, it } from "vitest";
import {
  calendarEventBelongsOnHub,
  capHubList,
  clusterRepoWork,
  eventOverlapsHubWindow,
  hubCalendarEvents,
  HUB_NOTES_PREVIEW,
  isJiraDone,
  isJiraInProgress,
  noteBelongsToRepo,
  taskBelongsToRepo,
  taskLinksRepo,
} from "./work-hub";

const nowMs = Date.parse("2026-08-27T12:00:00Z");

const repoTask = {
  id: "t1",
  text: "Ship footer",
  date: "2026-08-27",
  jiraKey: "PTF-1",
  links: [{ kind: "repo" as const, id: "atlas", label: "atlas" }],
};

describe("clusterRepoWork — PR association", () => {
  /**
   * Every other case here passes `prs: []`, and so did the API route until the
   * repo hub started sending real ones — the matching below had no coverage in
   * production or in tests.
   */
  const pr = {
    url: "https://github.com/businessinsider/atlas/pull/42",
    title: "Ship footer",
    repo: "businessinsider/atlas",
    number: 42,
  };

  /** No jiraKey: a ticket-less task is what seeds a standalone `task:` cluster. */
  const prTask = {
    id: "t1",
    text: "Ship footer",
    date: "2026-08-27",
    links: [{ kind: "repo" as const, id: "atlas", label: "atlas" }],
  };

  it("attaches a PR to its cluster when the task links it by url", () => {
    const model = clusterRepoWork({
      repoName: "atlas",
      fullName: "businessinsider/atlas",
      tasks: [
        {
          ...prTask,
          links: [
            ...prTask.links,
            { kind: "pr" as const, id: "businessinsider/atlas#42", label: "atlas#42", href: pr.url },
          ],
        },
      ],
      tickets: [],
      notes: [],
      prs: [pr],
      events: [],
    });
    expect(model.clusters[0]?.prs.map((row) => row.url)).toEqual([pr.url]);
    expect(model.leftoverPrs).toEqual([]);
  });

  it("matches by owner/repo#number when the ref carries no href", () => {
    const model = clusterRepoWork({
      repoName: "atlas",
      fullName: "businessinsider/atlas",
      tasks: [
        {
          ...prTask,
          links: [
            ...prTask.links,
            { kind: "pr" as const, id: "BusinessInsider/Atlas#42", label: "atlas#42" },
          ],
        },
      ],
      tickets: [],
      notes: [],
      prs: [pr],
      events: [],
    });
    expect(model.clusters[0]?.prs.map((row) => row.number)).toEqual([42]);
  });

  it("leaves an unreferenced PR in leftoverPrs rather than dropping it", () => {
    const model = clusterRepoWork({
      repoName: "atlas",
      fullName: "businessinsider/atlas",
      tasks: [prTask],
      tickets: [],
      notes: [],
      prs: [pr],
      events: [],
    });
    expect(model.clusters[0]?.prs).toEqual([]);
    expect(model.leftoverPrs.map((row) => row.url)).toEqual([pr.url]);
  });
});

describe("clusterRepoWork", () => {
  it("clusters a repo-linked task with one-hop jira and note, leftover notes stay out", () => {
    const model = clusterRepoWork({
      repoName: "atlas",
      fullName: "businessinsider/atlas",
      tasks: [repoTask],
      tickets: [{ key: "PTF-1", summary: "Footer", status: "In Progress", url: "https://jira/PTF-1" }],
      notes: [
        { slug: "task-notes/footer", title: "Footer note", href: "/notes/task-notes/footer" },
        { slug: "other", title: "Unrelated", href: "/notes/other" },
      ],
      prs: [],
      events: [],
    });
    expect(model.clusters).toHaveLength(1);
    expect(model.clusters[0]?.inProgress).toBe(true);
    expect(model.clusters[0]?.jira?.key).toBe("PTF-1");
    expect(model.clusters[0]?.tasks.map((task) => task.id)).toEqual(["t1"]);
    expect(model.leftoverNotes.map((note) => note.slug)).toEqual(["task-notes/footer", "other"]);
  });

  it("walks one hop from in-progress Jira onto a repo-linked task", () => {
    const model = clusterRepoWork({
      repoName: "atlas",
      fullName: null,
      tasks: [repoTask],
      tickets: [{ key: "PTF-1", summary: "Footer", status: "In Progress", url: "https://jira/PTF-1" }],
      notes: [{ slug: "from-jira", title: "Design", href: "/notes/from-jira" }],
      prs: [],
      events: [],
      jiraHops: [
        {
          key: "PTF-1",
          related: [{ kind: "task", id: "t1", label: "Ship footer" }],
          notes: [{ kind: "note", id: "from-jira", label: "Design" }],
        },
      ],
    });
    expect(model.clusters[0]?.notes.map((note) => note.slug)).toEqual(["from-jira"]);
    expect(model.leftoverNotes).toHaveLength(0);
  });

  it("keeps in-progress in Active work and other open tickets off to the side", () => {
    const model = clusterRepoWork({
      repoName: "atlas",
      fullName: null,
      tasks: [
        repoTask,
        {
          id: "t2",
          text: "Backlog chore",
          date: "2026-08-27",
          jiraKey: "PTF-9",
          links: [{ kind: "repo", id: "atlas", label: "atlas" }],
        },
      ],
      tickets: [
        { key: "PTF-9", summary: "Chore", status: "To Do", url: "https://jira/PTF-9", updatedAt: "2026-08-26T10:00:00Z" },
        { key: "PTF-1", summary: "Footer", status: "In Progress", url: "https://jira/PTF-1" },
        { key: "PTF-8", summary: "Shipped", status: "Done", url: "https://jira/PTF-8" },
      ],
      notes: [],
      prs: [],
      events: [],
    });
    expect(model.clusters.map((cluster) => cluster.jira?.key)).toEqual(["PTF-1"]);
    expect(model.leftoverTasks.map((task) => task.id)).toEqual(["t2"]);
    // PTF-9 already has a backlog task row; listing the ticket too doubled it.
    expect(model.openTickets.map((ticket) => ticket.key)).toEqual([]);
  });

  it("keeps an open ticket that has no task row of its own", () => {
    const model = clusterRepoWork({
      repoName: "atlas",
      fullName: null,
      tasks: [repoTask],
      tickets: [
        { key: "PTF-1", summary: "Footer", status: "In Progress", url: "https://jira/PTF-1" },
        { key: "PTF-9", summary: "Chore", status: "To Do", url: "https://jira/PTF-9" },
      ],
      notes: [],
      prs: [],
      events: [],
      jiraHops: [
        {
          key: "PTF-9",
          related: [{ kind: "repo", id: "atlas", label: "atlas" }],
          notes: [],
        },
      ],
    });
    expect(model.leftoverTasks).toEqual([]);
    expect(model.openTickets.map((ticket) => ticket.key)).toEqual(["PTF-9"]);
  });

  it("does not treat an unlinked task as related", () => {
    expect(taskLinksRepo({ links: [] }, "atlas", null)).toBe(false);
    expect(taskBelongsToRepo({ text: "chore", links: [] }, "atlas", null)).toBe(false);
    expect(isJiraInProgress("In Progress")).toBe(true);
    expect(isJiraInProgress("Done")).toBe(false);
    expect(isJiraDone("Done")).toBe(true);
    expect(isJiraDone("To Do")).toBe(false);
  });

  it("finds a Today task via kind=repo entity-link without a #tag", () => {
    expect(
      taskBelongsToRepo(
        { text: "Ship footer", links: [{ kind: "repo", id: "app-poc", label: "app-poc" }] },
        "app-poc",
        null,
      ),
    ).toBe(true);
  });

  it("finds a task via #repo tag when there is no entity-link", () => {
    expect(taskBelongsToRepo({ text: "Ship footer #app-poc", links: [] }, "app-poc", null)).toBe(true);
  });

  it("does not bleed an atlas-only in-progress ticket onto app-poc", () => {
    const model = clusterRepoWork({
      repoName: "app-poc",
      fullName: null,
      tasks: [
        {
          id: "atlas-only",
          text: "Atlas comments",
          date: "2026-08-27",
          jiraKey: "PTF-4783",
          links: [{ kind: "repo", id: "atlas", label: "atlas" }],
        },
        {
          id: "orphan-4784",
          text: "App comments footer",
          date: "2026-08-27",
          jiraKey: "PTF-4784",
          links: [{ kind: "jira", id: "PTF-4784", label: "PTF-4784" }],
        },
      ],
      tickets: [
        { key: "PTF-4783", summary: "Atlas comments count", status: "In Progress", url: "https://jira/PTF-4783" },
        { key: "PTF-4784", summary: "App comments footer", status: "In Progress", url: "https://jira/PTF-4784" },
      ],
      notes: [],
      prs: [],
      events: [],
    });
    expect(model.clusters).toEqual([]);
    expect(model.openTickets).toEqual([]);
  });

  it("includes sibling tasks of an in-progress ticket even without a repo link", () => {
    const model = clusterRepoWork({
      repoName: "app-poc",
      fullName: null,
      tasks: [
        {
          id: "linked",
          text: "PR 3 #app-poc",
          date: "2026-08-27",
          createdAt: "2026-08-27T08:00:00Z",
          jiraKey: "PTF-1",
          links: [{ kind: "repo", id: "app-poc", label: "app-poc" }],
        },
        {
          id: "sibling",
          text: "Follow-up without repo link",
          date: "2026-08-27",
          createdAt: "2026-08-27T09:00:00Z",
          jiraKey: "PTF-1",
        },
      ],
      tickets: [{ key: "PTF-1", summary: "Footer", status: "In Progress", url: "https://jira/PTF-1" }],
      notes: [],
      prs: [],
      events: [],
    });
    expect(model.clusters[0]?.tasks.map((task) => task.id)).toEqual(["sibling", "linked"]);
  });

  it("drops leftover calendar that is only today's noise", () => {
    const model = clusterRepoWork({
      repoName: "atlas",
      fullName: null,
      nowMs,
      tasks: [],
      tickets: [],
      notes: [],
      prs: [],
      events: [
        { id: "standup", title: "Weekly standup", start: "2026-08-27T09:00:00Z" },
        { id: "dentist", title: "Dentist", start: "2026-08-27T14:00:00Z" },
      ],
    });
    expect(model.leftoverEvents).toEqual([]);
  });

  it("keeps leftover calendar with a repo tag or explicit repo link inside the window", () => {
    const model = clusterRepoWork({
      repoName: "atlas",
      fullName: "businessinsider/atlas",
      nowMs,
      tasks: [],
      tickets: [],
      notes: [],
      prs: [],
      events: [
        {
          id: "tagged",
          title: "Atlas planning",
          start: "2026-08-20T15:00:00Z",
          tags: ["atlas"],
        },
        {
          id: "linked",
          title: "Repo sync",
          start: "2026-09-05T10:00:00Z",
          links: [{ kind: "repo", id: "atlas", label: "atlas" }],
        },
        {
          id: "old-tag",
          title: "Ancient atlas kickoff",
          start: "2019-03-01T10:00:00Z",
          end: "2019-03-01T11:00:00Z",
          tags: ["atlas"],
        },
      ],
    });
    expect(model.leftoverEvents.map((event) => event.id)).toEqual(["linked", "tagged"]);
  });

  it("applies the date window to one-hop calendar from a repo-linked task", () => {
    const model = clusterRepoWork({
      repoName: "atlas",
      fullName: null,
      nowMs,
      tasks: [
        {
          ...repoTask,
          links: [
            { kind: "repo", id: "atlas", label: "atlas" },
            { kind: "calendar", id: "old-standup", label: "Standup" },
            { kind: "calendar", id: "recent-sync", label: "Sync" },
          ],
        },
      ],
      tickets: [{ key: "PTF-1", summary: "Footer", status: "In Progress", url: "https://jira/PTF-1" }],
      notes: [],
      prs: [],
      events: [
        { id: "old-standup", title: "2019 standup", start: "2019-01-08T09:00:00Z" },
        { id: "recent-sync", title: "Repo sync", start: "2026-08-26T16:00:00Z" },
      ],
    });
    expect(model.clusters[0]?.calendar.map((event) => event.id)).toEqual(["recent-sync"]);
    expect(hubCalendarEvents(model, nowMs).map((event) => event.id)).toEqual(["recent-sync"]);
  });

  it("sorts leftover notes newest first", () => {
    const model = clusterRepoWork({
      repoName: "atlas",
      fullName: null,
      tasks: [],
      tickets: [],
      notes: [
        { slug: "old", title: "Old", href: "/notes/old", ts: 1 },
        { slug: "new", title: "New", href: "/notes/new", ts: 9 },
        { slug: "mid", title: "Mid", href: "/notes/mid", ts: 5 },
      ],
      prs: [],
      events: [],
    });
    expect(model.leftoverNotes.map((note) => note.slug)).toEqual(["new", "mid", "old"]);
  });

  it("hydrates a one-hop note that is not in the recall list", () => {
    const model = clusterRepoWork({
      repoName: "atlas",
      fullName: null,
      tasks: [
        {
          ...repoTask,
          links: [
            { kind: "repo", id: "atlas", label: "atlas" },
            {
              kind: "note",
              id: "task-notes/footer",
              label: "Footer note",
              href: "/notes/task-notes/footer",
            },
          ],
        },
      ],
      tickets: [{ key: "PTF-1", summary: "Footer", status: "In Progress", url: "https://jira/PTF-1" }],
      notes: [],
      prs: [],
      events: [],
    });
    expect(model.clusters[0]?.notes.map((note) => note.slug)).toEqual(["task-notes/footer"]);
    expect(model.clusters[0]?.notes[0]?.title).toBe("Footer note");
  });

  it("attaches jira hop notes for an already-clustered ticket", () => {
    const model = clusterRepoWork({
      repoName: "atlas",
      fullName: null,
      tasks: [repoTask],
      tickets: [{ key: "PTF-1", summary: "Footer", status: "In Progress", url: "https://jira/PTF-1" }],
      notes: [],
      prs: [],
      events: [],
      jiraHops: [
        {
          key: "PTF-1",
          related: [],
          notes: [
            { kind: "note", id: "tickets/PTF-1", label: "PTF-1 note", href: "/notes/tickets/PTF-1" },
          ],
        },
      ],
    });
    expect(model.clusters[0]?.notes.map((note) => note.slug)).toEqual(["tickets/PTF-1"]);
  });

  it("hydrates hop notes for an Open ticket onto leftover notes, not Active work", () => {
    const model = clusterRepoWork({
      repoName: "atlas",
      fullName: null,
      tasks: [repoTask],
      tickets: [{ key: "PTF-1", summary: "Footer", status: "Open", url: "https://jira/PTF-1" }],
      notes: [],
      prs: [],
      events: [],
      jiraHops: [
        {
          key: "PTF-1",
          related: [],
          notes: [
            { kind: "note", id: "tickets/PTF-1", label: "PTF-1 note", href: "/notes/tickets/PTF-1" },
          ],
        },
      ],
    });
    expect(model.clusters).toEqual([]);
    // The repo task carries PTF-1, so the backlog row stands in for the ticket.
    expect(model.leftoverTasks.map((task) => task.id)).toEqual(["t1"]);
    expect(model.openTickets).toEqual([]);
    expect(model.leftoverNotes.map((note) => note.slug)).toEqual(["tickets/PTF-1"]);
  });
});

describe("noteBelongsToRepo", () => {
  it("matches projects/<repo> path prefix", () => {
    expect(
      noteBelongsToRepo(
        { slug: "projects/app-poc-article-screen-native-chrome-plan", title: "Chrome" },
        "app-poc",
      ),
    ).toBe(true);
    expect(
      noteBelongsToRepo({ slug: "projects/app-poc-article-screen-native-chrome-plan", title: "Chrome" }, "atlas"),
    ).toBe(false);
  });
});

describe("calendar hub window", () => {
  it("accepts events overlapping last 14 days or next 14 days", () => {
    expect(eventOverlapsHubWindow({ start: "2026-08-20T00:00:00Z" }, nowMs)).toBe(true);
    expect(eventOverlapsHubWindow({ start: "2026-09-05T00:00:00Z" }, nowMs)).toBe(true);
    expect(eventOverlapsHubWindow({ start: "2019-01-08T09:00:00Z" }, nowMs)).toBe(false);
    expect(eventOverlapsHubWindow({ start: "2026-12-01T00:00:00Z" }, nowMs)).toBe(false);
  });

  it("requires an explicit repo link or a tag that is this repo", () => {
    expect(calendarEventBelongsOnHub({ tags: ["standup"] }, "atlas", null)).toBe(false);
    expect(calendarEventBelongsOnHub({ tags: ["atlas"] }, "atlas", null)).toBe(true);
    expect(
      calendarEventBelongsOnHub(
        { links: [{ kind: "repo", id: "businessinsider/atlas", label: "atlas" }] },
        "atlas",
        "businessinsider/atlas",
      ),
    ).toBe(true);
  });
});

describe("capHubList", () => {
  it("caps notes at the preview count until expanded", () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    expect(capHubList(items, HUB_NOTES_PREVIEW, false)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(capHubList(items, HUB_NOTES_PREVIEW, true)).toHaveLength(12);
  });
});
