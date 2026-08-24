import { useSyncExternalStore } from "react";

/**
 * Line comments accumulated across files while reviewing a diff — the basket
 * that "Send all to AI" ships to the agent. Module-level store so comments
 * survive file switches and workspace tab changes within the session.
 */
export interface ReviewComment {
  id: string;
  filePath: string;
  staged: boolean;
  /** Hunk + body index at write time (same coords as the staging API). */
  hunkIndex: number;
  bodyIndex: number;
  /** Commented line's text, marker stripped — shown in the basket. */
  lineText: string;
  lineType: "add" | "del" | "ctx";
  text: string;
  createdAt: number;
}

let comments: ReviewComment[] = [];
let snapshot: ReviewComment[] = comments;
const listeners = new Set<() => void>();

function emit() {
  snapshot = comments;
  for (const listener of listeners) listener();
}

export const reviewCommentsStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot() {
    return snapshot;
  },
  /** Server render never has comments; avoids hydration mismatch. */
  getServerSnapshot(): ReviewComment[] {
    return [];
  },
  add(comment: Omit<ReviewComment, "id" | "createdAt">) {
    comments = [
      ...comments,
      { ...comment, id: crypto.randomUUID(), createdAt: Date.now() },
    ];
    emit();
  },
  remove(id: string) {
    comments = comments.filter((c) => c.id !== id);
    emit();
  },
  clearAll() {
    comments = [];
    emit();
  },
};

export function useReviewComments(): ReviewComment[] {
  return useSyncExternalStore(
    reviewCommentsStore.subscribe,
    reviewCommentsStore.getSnapshot,
    reviewCommentsStore.getServerSnapshot,
  );
}
