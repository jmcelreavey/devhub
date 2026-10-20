"use client";

import { defaultFetcher, useLive } from "@/lib/hooks/use-fetch";
import type { TaskProfileOverview } from "@/lib/tasks/profile-types";
import { profileKey } from "@/lib/tasks/profile-scope";
import type { GithubPrsApiPayload } from "@/lib/github/prs";
import { OWNED_REPOS_SWR_KEY } from "@/lib/ownership/owned-repos-swr";
import type { OwnedReposResponse } from "@/lib/ownership/types";
import { WORKFLOW_INBOX_KEY, type WorkflowInboxResponse } from "@/lib/workflows/inbox";
import type { NotesBoard } from "./notes-board-shared";

class PartialBoardError extends Error {
  constructor(readonly board: NotesBoard) { super("Some task sources are unavailable. Showing last-known work."); }
}

class GithubUnavailableError extends Error {
  constructor(readonly payload: GithubPrsApiPayload) { super("GitHub unavailable"); }
}

async function boardFetcher(url: string): Promise<NotesBoard> {
  const board = await defaultFetcher(url) as NotesBoard;
  if (board.errors.length) throw new PartialBoardError(board);
  return board;
}

async function prFetcher(url: string): Promise<GithubPrsApiPayload> {
  const payload = await defaultFetcher(url) as GithubPrsApiPayload;
  if (!payload.configured) throw new GithubUnavailableError(payload);
  return payload;
}

export function useProfileWork({ allDone = false, includePrs = false }: { allDone?: boolean; includePrs?: boolean } = {}) {
  const profile = useLive<TaskProfileOverview>("/api/tasks/profiles");
  const profileId = profile.data ? profile.data.active ?? "legacy" : undefined;
  const board = useLive<NotesBoard>(profileKey(`/api/storyboard${allDone ? "?done=all" : ""}`, profileId), { refreshInterval: 15_000, fetcher: boardFetcher, keepPreviousData: false });
  const inbox = useLive<WorkflowInboxResponse>(profileKey(WORKFLOW_INBOX_KEY, profileId), { refreshInterval: 15_000, keepPreviousData: false });
  const prs = useLive<GithubPrsApiPayload>(includePrs ? profileKey("/api/github/prs", profileId) : null, { refreshInterval: 60_000, fetcher: prFetcher, keepPreviousData: false });
  const owned = useLive<OwnedReposResponse>(includePrs ? OWNED_REPOS_SWR_KEY : null, { refreshInterval: 60_000 });
  const partial = board.error instanceof PartialBoardError ? board.error.board : undefined;
  const unavailable = prs.error instanceof GithubUnavailableError ? prs.error.payload : undefined;
  return { profile, profileId, board: { ...board, data: board.data ?? partial }, inbox, prs: { ...prs, data: prs.data ?? unavailable }, owned };
}
