"use client";

import { CapabilityDriftNudges } from "@/components/CapabilityDriftNudges";
import { DigestBanners } from "@/components/DigestBanners";
import { NoteTaskLinksPanel } from "@/components/NoteTaskLinksPanel";

/** Top-of-Today strip: digests, capability drift, note↔task links. */
export function TodayBannersHost() {
  return (
    <div className="px-4 pt-3 sm:px-6">
      <DigestBanners />
      <CapabilityDriftNudges />
      <NoteTaskLinksPanel />
    </div>
  );
}
