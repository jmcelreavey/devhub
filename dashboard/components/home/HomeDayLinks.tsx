"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { profileKey } from "@/lib/tasks/profile-scope";
import { dailyNotePath, todayISO } from "@/lib/utils";
import { notesPageHref } from "@/lib/notes/path";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { FetchError } from "@/components/ui/FetchError";
import { WORKTREE_CLEANUP_KEY, WORKTREE_CLEANUP_OPTS } from "@/components/prs/WorktreeCleanupPanel";
import { OWNED_PRS_KEY, type OwnedPrsResponse } from "@/lib/github/owned-prs";
import type { WorktreeCleanupResult } from "@/lib/repos/worktree-cleanup";
import type { GithubPrsApiPayload } from "@/lib/github/prs";
import { prIdentity } from "@/lib/github/actionable-prs";
import type { CalendarEvent } from "@/lib/google-calendar";
import type { JiraTicket } from "@/lib/jira/client";
import { HomePreviewToggle } from "./HomePreviewToggle";
import { HomePrRow, HomeTicketRow } from "./HomeRows";
import styles from "./HomeWorkSummary.module.css";

interface CalendarResponse { events?: CalendarEvent[]; needsReauth?: boolean; error?: string }
interface TicketsResponse { tickets?: JiraTicket[]; configured: boolean; error?: string }
const PREVIEW_LIMIT = 3;
const SCOPED = { keepPreviousData: false } as const;

function scopedHref(href: string, profile?: string): string {
  return profile ? `${href}${href.includes("?") ? "&" : "?"}profile=${encodeURIComponent(profile)}` : href;
}

export function HomeContext({ now, profile, unavailable }: { now: number; profile?: string; unavailable: boolean }) {
  const calendar = useLive<CalendarResponse>(profileKey("/api/calendar", profile), SCOPED);
  const cleanup = useLive<WorktreeCleanupResult>(profileKey(WORKTREE_CLEANUP_KEY, profile), { ...WORKTREE_CLEANUP_OPTS, ...SCOPED });
  const calendarUnavailable = unavailable || calendar.error || calendar.data?.error || calendar.data?.needsReauth;
  const next = calendar.data?.events?.filter((event) => !event.isAllDay && Date.parse(event.end) > now).sort((a, b) => a.start.localeCompare(b.start))[0];
  const day = now ? todayISO(new Date(now)) : undefined;
  const cleanupUnavailable = unavailable || cleanup.error || !!cleanup.data?.failedRepos.length;
  return <nav className={styles.context} aria-label="Day context">
    <Link href="/calendar" className={styles.meeting}><CalendarDays size={14} aria-hidden />
      {calendarUnavailable ? "Calendar unavailable →"
        : !calendar.data || !now ? <span className="skeleton" aria-label="Loading calendar" style={{ width: 140, height: 12 }} />
        : next ? <span>{Date.parse(next.start) <= now ? "Now" : `Next meeting ${new Date(next.start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`} · {next.title}</span>
        : calendar.data.events?.length ? "No more meetings today →" : "No meetings today →"}
    </Link>
    <Link href="/briefing">Briefing →</Link>
    <Link href={day ? notesPageHref(dailyNotePath(day)) : "/notes"}>Today&apos;s note →</Link>
    <Link href={scopedHref("/prs?tab=cleanup", profile)}>
      {cleanupUnavailable ? "Worktrees · count unavailable →" : !cleanup.data ? <span className="skeleton" aria-label="Loading worktrees" style={{ display: "inline-block", width: 125, height: 12 }} /> : `Worktrees · ${cleanup.data.rows.length} finished →`}
    </Link>
  </nav>;
}

export function HomeDayLinks({ profile, unavailable, prs, githubUnavailable }: {
  profile?: string; unavailable: boolean; prs?: GithubPrsApiPayload; githubUnavailable: boolean;
}) {
  const tickets = useLive<TicketsResponse>(profileKey("/api/jira/tickets", profile), SCOPED);
  const [ticketsExpanded, setTicketsExpanded] = useState(false);
  const [prsExpanded, setPrsExpanded] = useState(false);
  const [prTab, setPrTab] = useState<"authored" | "owned" | "reviews">("authored");
  const owned = useLive<OwnedPrsResponse>(prTab === "owned" ? profileKey(OWNED_PRS_KEY, profile) : null, { ...SCOPED, refreshInterval: 120_000 });
  const jiraUnavailable = unavailable || !!tickets.error || !!tickets.data?.error || tickets.data?.configured === false;
  const ownedUnavailable = unavailable || !!owned.error || !!owned.data?.failedRepos.length;
  const rows = unavailable ? [] : [...new Map(((prTab === "authored" ? prs?.authored : prTab === "reviews" ? prs?.reviews : owned.data?.prs) ?? []).map((pr) => [prIdentity(pr), pr])).values()];
  const prUnavailable = prTab === "owned" ? ownedUnavailable : githubUnavailable;
  const prLoaded = prTab === "owned" ? !!owned.data : !!prs;
  const category = prTab === "authored" ? "my" : prTab === "reviews" ? "review requested" : "owned";
  const prLimited = prTab === "owned" && owned.data?.limited;
  return <div className={styles.dayLinks}>
    <section className={styles.section} aria-labelledby="home-tickets">
      <div className={styles.sectionHead}>
        <h2 id="home-tickets">Tickets</h2>
        <span className={styles.count} aria-label={jiraUnavailable || !tickets.data ? "Tickets total unavailable" : `${tickets.data.tickets?.length ?? 0} tickets`}>{jiraUnavailable || !tickets.data ? "—" : tickets.data.tickets?.length ?? 0}</span>
        <Link href={scopedHref("/work?tab=jira", profile)} aria-label="View all tickets">View all →</Link>
      </div>
      {jiraUnavailable ? <FetchError bare message="Jira unavailable. Ticket totals are unavailable." onRetry={() => void tickets.mutate()} /> : null}
      {!tickets.data && !jiraUnavailable ? <div aria-busy="true" aria-label="Loading tickets"><SkeletonRows count={2} height={40} variant="list" /></div> : null}
      <ul id="home-ticket-items" className={styles.compactList}>
        {(tickets.data?.tickets ?? []).slice(0, ticketsExpanded ? undefined : PREVIEW_LIMIT).map((ticket) => <HomeTicketRow key={ticket.key} ticket={ticket} profile={profile} onChanged={() => void tickets.mutate()} />)}
      </ul>
      <HomePreviewToggle total={tickets.data?.tickets?.length ?? 0} limit={PREVIEW_LIMIT} expanded={ticketsExpanded} onToggle={() => setTicketsExpanded(!ticketsExpanded)} controls="home-ticket-items" />
      {!jiraUnavailable && tickets.data && !tickets.data.tickets?.length ? <p className={styles.empty}>No open tickets assigned to you</p> : null}
    </section>
    <section className={styles.section} aria-labelledby="home-prs">
      <div className={styles.sectionHead}>
        <h2 id="home-prs">PRs</h2>
        <div className={styles.prTabs} role="group" aria-label="PR category">
          <button type="button" aria-pressed={prTab === "authored"} onClick={() => { setPrTab("authored"); setPrsExpanded(false); }}>Mine</button>
          <button type="button" aria-pressed={prTab === "owned"} onClick={() => { setPrTab("owned"); setPrsExpanded(false); }}>Owned</button>
          <button type="button" aria-pressed={prTab === "reviews"} onClick={() => { setPrTab("reviews"); setPrsExpanded(false); }}>Review</button>
        </div>
        <span className={styles.count} aria-label={prUnavailable || !prLoaded ? "PR total unavailable" : `${prLimited ? "At least " : ""}${rows.length} ${category} PRs`}>{prUnavailable || !prLoaded ? "—" : `${rows.length}${prLimited ? "+" : ""}`}</span>
        <Link href={scopedHref(`/prs?tab=${prTab}`, profile)} aria-label={`View all ${category} PRs`}>View all →</Link>
      </div>
      {prUnavailable ? prTab === "owned" ? <FetchError bare message="GitHub unavailable. Owned PR totals are unavailable." onRetry={() => void owned.mutate()} /> : <p className={styles.empty}>GitHub unavailable · see Retry above</p> : null}
      {!prLoaded && !prUnavailable ? <div aria-busy="true" aria-label="Loading PRs"><SkeletonRows count={2} height={40} variant="list" /></div> : null}
      <ul id="home-pr-items" className={styles.compactList}>
        {rows.slice(0, prsExpanded ? undefined : PREVIEW_LIMIT).map((pr) => <HomePrRow key={pr.url} pr={pr} tab={prTab} />)}
      </ul>
      <HomePreviewToggle total={rows.length} limit={PREVIEW_LIMIT} expanded={prsExpanded} onToggle={() => setPrsExpanded(!prsExpanded)} controls="home-pr-items" />
      {!prUnavailable && prLoaded && !rows.length ? <p className={styles.empty}>{prTab === "authored" ? "No open PRs of yours" : prTab === "reviews" ? "No PR reviews requested" : <>No open PRs in your <Link href="/own">Owned repositories</Link></>}</p> : null}
    </section>
  </div>;
}
