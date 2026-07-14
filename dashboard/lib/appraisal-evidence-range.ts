export const EVIDENCE_RANGE_PRESETS = [7, 14, 30, 90] as const;
export type EvidenceRangeDays = (typeof EVIDENCE_RANGE_PRESETS)[number];

export const EVIDENCE_RANGE_STORAGE_KEY = "devhub:appraisal-evidence-days";

const PRESET_SET = new Set<number>(EVIDENCE_RANGE_PRESETS);

export function parseEvidenceDays(raw: string | null | undefined, fallback: EvidenceRangeDays = 7): EvidenceRangeDays {
  const n = Number(raw);
  if (PRESET_SET.has(n)) return n as EvidenceRangeDays;
  return fallback;
}

/** Clamp API `days` query to a sane window (presets up to 90). */
export function clampEvidenceDays(raw: unknown, fallback = 7): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(90, Math.max(1, Math.round(n)));
}

export function evidenceRangeLabel(days: number): string {
  return `LAST ${days}D`;
}
