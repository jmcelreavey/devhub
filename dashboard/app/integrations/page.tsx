import { Suspense } from "react";
import type { Metadata } from "next";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import IntegrationsClient from "./client";
export const metadata: Metadata = { title: "Integrations" };
export default function Page() { return <Suspense fallback={<div className="page-wrapper"><SkeletonRows /></div>}><IntegrationsClient /></Suspense>; }
