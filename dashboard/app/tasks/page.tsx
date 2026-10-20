import { Suspense } from "react";
import { LegacyWorkRedirect } from "@/components/tasks/LegacyWorkRedirect";

/** /tasks is extinct — /work is canonical (tasks tab). */
export default function TasksRedirectPage() {
  return <Suspense fallback={<div className="page-wrapper" />}><LegacyWorkRedirect tab="tasks" /></Suspense>;
}
