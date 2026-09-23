"use client";

import { CapabilityDriftNudges } from "@/components/capability/CapabilityDriftNudges";
import { DigestBanners } from "@/components/briefing/DigestBanners";
import { WorktreeCleanupNudge } from "@/components/today/WorktreeCleanupNudge";

/** Top-of-Today strip: digests, capability drift, and leftover worktrees. */
export function TodayBannersHost() {
  return (
    <div className="px-4 pt-3 sm:px-6">
      <DigestBanners />
      <CapabilityDriftNudges />
      <WorktreeCleanupNudge />
    </div>
  );
}
