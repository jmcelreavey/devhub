"use client";

import { CapabilityDriftNudges } from "@/components/CapabilityDriftNudges";
import { DigestBanners } from "@/components/DigestBanners";

/** Top-of-Today strip: digests and capability drift. */
export function TodayBannersHost() {
  return (
    <div className="px-4 pt-3 sm:px-6">
      <DigestBanners />
      <CapabilityDriftNudges />
    </div>
  );
}
