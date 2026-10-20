import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Quiet way into the full briefing, now that it no longer has a sidebar row.
 * Sits in the hero's meta row after "Yesterday", in both Today views.
 */
export function TodayBriefingLink() {
  return (
    <>
      <span aria-hidden>·</span>
      <Link href="/briefing" className="hub-hero-link">
        Briefing <ArrowRight size={11} aria-hidden />
      </Link>
    </>
  );
}
