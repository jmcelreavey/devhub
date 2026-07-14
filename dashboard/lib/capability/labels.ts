/**
 * Capability Radar — display names for signal areas. Client-safe (no node
 * imports); the single source of truth for every view that renders areas.
 */

import type { SignalArea } from "./types";

export const AREA_LABEL: Record<SignalArea, string> = {
  runtime: "Runtime",
  infra: "Infrastructure",
  deploy: "Deploy / GitOps",
  data: "Data",
  observability: "Observability",
  ci: "CI",
  arch: "Architecture",
};

/** Compact variants for tight rows (repo-level radar). */
export const AREA_LABEL_SHORT: Record<SignalArea, string> = {
  runtime: "Runtime",
  infra: "Infra",
  deploy: "Deploy",
  data: "Data",
  observability: "Observability",
  ci: "CI",
  arch: "Arch",
};

/** Display order — most architecture-relevant areas first. */
export const AREA_ORDER: SignalArea[] = ["deploy", "infra", "data", "observability", "ci", "runtime", "arch"];
