/**
 * Client-safe slice of the daily reps feature: types and pure helpers shared
 * by the rep page, cards, and the server storage module. No node imports —
 * this is bundled into client components.
 */

export type RepKind = "cold-read" | "gap-sketch" | "recall";

export const REP_KIND_LABEL: Record<RepKind, string> = {
  "cold-read": "Cold read",
  "gap-sketch": "Gap sketch",
  recall: "Recall",
};

export interface ColdReadMaterial {
  kind: "cold-read";
  /** owner/name of the owned repo the commit came from. */
  repo: string;
  sha: string;
  committedAt: string;
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface ColdReadReveal {
  kind: "cold-read";
  /** The real commit message, hidden while the rep is in progress. */
  subject: string;
  body: string;
  author: string;
  url: string;
}

export interface GapSketchMaterial {
  kind: "gap-sketch";
  repo: string;
  domainId: string;
  label: string;
  paths: string[];
  commits90d: number;
  authoredByMe: number;
}

export interface GapSketchReveal {
  kind: "gap-sketch";
  /** Recent commit subjects in the domain — what actually happened there. */
  recentSubjects: string[];
  learnHref: string;
}

export interface RecallMaterial {
  kind: "recall";
  title: string;
  diagramPath: string;
}

export interface RecallReveal {
  kind: "recall";
  href: string;
}

export type RepMaterial = ColdReadMaterial | GapSketchMaterial | RecallMaterial;
export type RepReveal = ColdReadReveal | GapSketchReveal | RecallReveal;

/** What the generator produces; storage adds dates and the response. */
export interface GeneratedRep {
  kind: RepKind;
  material: RepMaterial;
  reveal: RepReveal;
}

export interface Rep extends GeneratedRep {
  date: string;
  /** Bumped on every swap so regeneration is seeded differently. */
  attempt: number;
  startedAt: string;
  /** The user's written answer, markdown. */
  response?: string;
  /** Set when the response is saved — this is what the streak counts. */
  completedAt?: string;
}

/** Client-facing rep: the reveal is withheld until the rep is completed. */
export interface PublicRep extends Omit<Rep, "reveal"> {
  reveal?: RepReveal;
}

export interface RepDayPoint {
  date: string;
  done: boolean;
}

export interface RepStats {
  streak: number;
  completedCount: number;
  /** Last 35 days ending today, oldest first. */
  recent: RepDayPoint[];
}

/** GET /api/reps response body (client + server). */
export interface RepsApiPayload {
  rep: PublicRep | null;
  stats: RepStats;
}

/** Strip the answer until the rep is done. */
export function toPublicRep(rep: Rep | null): PublicRep | null {
  if (!rep) return null;
  if (rep.completedAt) return rep;
  const publicRep: PublicRep = { ...rep };
  delete publicRep.reveal;
  return publicRep;
}

/** One-line description of the material, for cards and signals. */
export function repTeaser(rep: Pick<Rep, "material">): string {
  const material = rep.material;
  if (material.kind === "cold-read") {
    return `Cold read: ${material.repo.split("/")[1] ?? material.repo} @ ${material.sha.slice(0, 7)}`;
  }
  if (material.kind === "gap-sketch") {
    return `Gap sketch: ${material.label} in ${material.repo.split("/")[1] ?? material.repo}`;
  }
  return `Recall: ${material.title}`;
}
