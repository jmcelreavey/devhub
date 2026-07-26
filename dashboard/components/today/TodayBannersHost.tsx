"use client";

import { CapabilityDriftNudges } from "@/components/capability/CapabilityDriftNudges";
import { DigestBanners } from "@/components/briefing/DigestBanners";

/** Top-of-Today strip: digests and capability drift. */
export function TodayBannersHost() {
  return (
    <div className="px-4 pt-3 sm:px-6">
      <DigestBanners />
      <CapabilityDriftNudges />
    </div>
  );
}
