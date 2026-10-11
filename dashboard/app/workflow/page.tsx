import { Suspense } from "react";
import type { Metadata } from "next";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import WorkflowClient from "./client";
export const metadata: Metadata = { title: "Task workflow" };
export default function Page() {
  return <Suspense fallback={<div className="page-wrapper"><SkeletonRows /></div>}><WorkflowClient /></Suspense>;
}
