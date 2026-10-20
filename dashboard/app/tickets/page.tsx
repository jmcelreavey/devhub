import { Suspense } from "react";
import { LegacyWorkRedirect } from "@/components/tasks/LegacyWorkRedirect";

/** /tickets is extinct — /work is canonical (Jira tab). */
export default function TicketsRedirectPage() {
  return <Suspense fallback={<div className="page-wrapper" />}><LegacyWorkRedirect tab="jira" /></Suspense>;
}
