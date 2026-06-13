import Link from "next/link";
import { Compass, ArrowLeft, Search } from "lucide-react";

/**
 * 404 — keeps the app chrome (layout still wraps this), offers the two
 * useful exits: home and search.
 */
export default function NotFound() {
  return (
    <div className="page-wrapper flex items-center justify-center" style={{ minHeight: "60vh" }}>
      <div className="card flex max-w-md flex-col items-center px-8 py-10 text-center">
        <span className="empty-pop" style={{ color: "var(--text-subtle)" }} aria-hidden>
          <Compass size={36} />
        </span>
        <h1 className="mt-4 mb-1" style={{ fontSize: 19, fontWeight: 600, color: "var(--text)" }}>
          This page wandered off
        </h1>
        <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
          Nothing lives at this address. It may have moved in the last reshuffle — search knows where
          everything went.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link href="/" className="btn btn-primary">
            <ArrowLeft size={13} aria-hidden /> Back to Today
          </Link>
          <Link href="/search" className="btn btn-ghost">
            <Search size={13} aria-hidden /> Search everything
          </Link>
        </div>
      </div>
    </div>
  );
}
