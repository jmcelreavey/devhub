import { NextResponse } from "next/server";
import { readDashboardEnvLocalFile, resolveEnvValue } from "@/lib/dashboard-env-local";
import { getMyAssignedTicketsTouchedInRange, type JiraStandupTicket } from "@/lib/jira-client";
import { getTasks } from "@/lib/tasks-storage";
import { buildStandupMarkdown } from "@/lib/standup-markdown";
import {
  getGitUserEmail,
  gitFetch,
  gitLogLinesLocalMidnightWindow,
  localCalendarDateISO,
  localDatetimeMillis,
  localYesterdayISO,
  millisToLocalGitDatetime,
} from "@/lib/standup-git";
import {
  fetchAuthoredPrSlices,
  fetchMergedPrsReviewedOthersInRange,
  getGithubLogin,
} from "@/lib/standup-github-merged";
import { listRepos, type RepoInfo } from "@/lib/repos";
import { withErrorHandler } from "@/lib/api-utils";
import { pMapSettled } from "@/lib/p-limit";
import {
  MAX_GIT,
  MAX_JIRA_SHOW,
  MAX_MERGED_AUTHORED,
  MAX_MERGED_REVIEWED,
  MAX_PRS_CREATED,
  MERGED_PER_REPO,
  SUBPROCESS_CONCURRENCY,
} from "@/lib/standup-config";

function isJiraConfigured(): boolean {
  const { overrides } = readDashboardEnvLocalFile();
  return !!(
    resolveEnvValue("JIRA_DOMAIN", overrides) &&
    resolveEnvValue("JIRA_EMAIL", overrides) &&
    resolveEnvValue("JIRA_API_TOKEN", overrides)
  );
}

export const dynamic = "force-dynamic";

/**
 * Per-repo commit collection — fetch, resolve git user.email, run the log window.
 *
 * `user.email` is the right `--author` filter (not the GitHub login): git
 * substring-matches on the commit's Author line, which contains the email the
 * user configured locally, not the GitHub handle.
 */
async function collectCommitsForRepo(
  repo: RepoInfo,
  sinceGit: string,
  untilGit: string,
): Promise<{ name: string; subjects: string[]; truncated: boolean }> {
  await gitFetch(repo.path);
  const authorMatch = (await getGitUserEmail(repo.path)) ?? undefined;
  const { lines, truncated } = await gitLogLinesLocalMidnightWindow(
    repo.path,
    sinceGit,
    untilGit,
    MAX_GIT,
    { authorMatch, allRefs: true },
  );
  return { name: repo.name, subjects: lines, truncated };
}

export const GET = withErrorHandler(async (request: Request) => {
  console.time("standup");
  const url = new URL(request.url);
  const now = new Date();
  const localToday = localCalendarDateISO(now);
  const localYesterday = localYesterdayISO(now);

  const startDate = url.searchParams.get("startDate") || localYesterday;
  const endDate = url.searchParams.get("endDate") || localToday;
  const startTime = url.searchParams.get("startTime") || "00:00";
  const endTime = url.searchParams.get("endTime") || "23:59";

  // Comma-separated list of repo names to exclude (matches `RepoInfo.name`).
  const excludeRepos = new Set(
    (url.searchParams.get("excludeRepos") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const sinceMs = localDatetimeMillis(startDate, startTime);
  const untilExclusiveMs = localDatetimeMillis(endDate, endTime) + 60_000;

  const sinceGit = millisToLocalGitDatetime(sinceMs);
  const untilGit = millisToLocalGitDatetime(untilExclusiveMs);

  // GitHub login + local repo scan are independent — run in parallel.
  console.time("standup:prep");
  const [login, allRepos] = await Promise.all([getGithubLogin(), listRepos()]);
  const reposForCommits = allRepos.filter((r) => !excludeRepos.has(r.name));
  console.timeEnd("standup:prep");

  // Per-repo git fetch + log, capped at SUBPROCESS_CONCURRENCY concurrent spawns.
  console.time("standup:git");
  const logResults = await pMapSettled(reposForCommits, SUBPROCESS_CONCURRENCY, (r) =>
    collectCommitsForRepo(r, sinceGit, untilGit),
  );
  console.timeEnd("standup:git");

  const gitCommitsByRepo: Record<string, { subjects: string[]; truncated: boolean }> = {};
  for (const res of logResults) {
    if (res.status !== "fulfilled") continue;
    if (res.value.subjects.length === 0) continue;
    gitCommitsByRepo[res.value.name] = {
      subjects: res.value.subjects,
      truncated: res.value.truncated,
    };
  }

  // Authored PR slices + Jira run in parallel; reviewed-others depends on the
  // authored URLs, so it's a follow-up step.
  const rangeFinite = Number.isFinite(sinceMs) && Number.isFinite(untilExclusiveMs);
  const jiraOn = isJiraConfigured();

  console.time("standup:prs+jira");
  const [authoredSlices, jiraOutcome] = await Promise.all([
    rangeFinite
      ? fetchAuthoredPrSlices({
          login,
          createdSinceYmd: startDate,
          sinceMs,
          untilExclusiveMs,
          maxPerRepo: MERGED_PER_REPO,
          maxMergedAuthored: MAX_MERGED_AUTHORED,
          maxPrsCreated: MAX_PRS_CREATED,
        })
      : Promise.resolve({ mergedAuthored: [], prsCreated: [], prScanFailedRepos: [] }),
    jiraOn
      ? getMyAssignedTicketsTouchedInRange(startDate, endDate, startTime, endTime).catch((e) => {
          console.error("[standup:jira]", e);
          return [] as JiraStandupTicket[];
        })
      : Promise.resolve([] as JiraStandupTicket[]),
  ]);
  console.timeEnd("standup:prs+jira");

  let mergedReviewedOthers: Awaited<ReturnType<typeof fetchMergedPrsReviewedOthersInRange>> = [];
  if (rangeFinite && login) {
    console.time("standup:prs-reviewed");
    mergedReviewedOthers = await fetchMergedPrsReviewedOthersInRange({
      login,
      mergedSinceYmd: startDate,
      sinceMs,
      untilExclusiveMs,
      maxTotal: MAX_MERGED_REVIEWED,
      excludeAuthoredUrls: new Set(authoredSlices.mergedAuthored.map((p) => p.url)),
    });
    console.timeEnd("standup:prs-reviewed");
  }

  let jiraActivity = jiraOutcome;
  let jiraTruncated = false;
  if (jiraActivity.length > MAX_JIRA_SHOW) {
    jiraTruncated = true;
    jiraActivity = jiraActivity.slice(0, MAX_JIRA_SHOW);
  }

  const tasks = getTasks(localToday);
  const tasksCompleted = tasks
    .filter((t) => t.done)
    .map((t) => ({ text: t.text, jiraKey: t.jiraKey, timeSpentMs: t.timeSpentMs }));

  const markdown = buildStandupMarkdown({
    localToday,
    gitCommitsByRepo,
    jiraConfigured: jiraOn,
    jiraActivity,
    jiraTruncated,
    mergedAuthored: authoredSlices.mergedAuthored,
    mergedReviewedOthers,
    prsCreated: authoredSlices.prsCreated,
    tasksCompleted,
  });

  // Partial-failure metadata so the UI can surface "N of M repos failed to fetch".
  const repoFailures = logResults
    .map((res, i) => ({ res, name: reposForCommits[i]?.name ?? "?" }))
    .filter((x) => x.res.status === "rejected")
    .map((x) => x.name);

  console.timeEnd("standup");

  const response = NextResponse.json({
    markdown,
    meta: {
      reposScanned: reposForCommits.length,
      reposExcluded: excludeRepos.size,
      repoFailures,
      reposScannedNames: reposForCommits.map((r) => r.name),
      prScanFailedRepos: authoredSlices.prScanFailedRepos,
    },
  });
  response.headers.set("cache-control", "no-store, must-revalidate");
  return response;
}, "standup.markdown");
