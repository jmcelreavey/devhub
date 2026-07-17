import Link from "next/link";
import { Compass, ArrowLeft, Search } from "lucide-react";

/**
 * 404 — keeps the app chrome (layout still wraps this), offers the two
 * useful exits: home and search. Left-bias composition (not centered hero).
 */
export default function NotFound() {
  return (
    <div className="page-wrapper" style={{ minHeight: "60vh", paddingTop: "var(--space-10)" }}>
      <div className="max-w-md">
        <span className="empty-pop" style={{ color: "var(--text-subtle)" }} aria-hidden>
          <Compass size={28} />
        </span>
        <h1
          className="mt-4 mb-1"
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: "var(--text)",
            letterSpacing: "-0.02em",
          }}
        >
          This page wandered off
        </h1>
        <p className="text-sm mb-6" style={{ color: "var(--text-muted)", maxWidth: "36ch" }}>
          Nothing lives at this address. It may have moved in the last reshuffle - search knows where
          everything went.
        </p>
        <div className="flex flex-wrap items-center gap-2">
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
