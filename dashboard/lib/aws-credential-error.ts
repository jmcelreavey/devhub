import { NextResponse } from "next/server";

// AWS SDK surfaces missing/expired credentials through a few different error
// strings depending on which step fails (token load vs. signing vs. STS).
const MISSING_CREDENTIAL_MARKERS = [
  "NoCredentials",
  "Unable to locate credentials",
  "ExpiredToken",
];

/**
 * Maps an AWS "no/expired credentials" error to a 401 the Ops UI renders as a
 * re-auth prompt. Returns null for any other error so callers fall through to
 * their own 500 handling. Shared by the RDS routes to keep the marker list and
 * user-facing copy in one place.
 */
export function awsCredentialErrorResponse(e: unknown): NextResponse | null {
  const message = (e as Error).message ?? "";
  if (!MISSING_CREDENTIAL_MARKERS.some((marker) => message.includes(marker))) {
    return null;
  }
  return NextResponse.json(
    { error: "AWS credentials expired or missing. Sign in via AWS Profile first." },
    { status: 401 },
  );
}
