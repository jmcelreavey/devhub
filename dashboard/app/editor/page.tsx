import { Suspense } from "react";
import type { Metadata } from "next";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import EditorClient from "./client";
export const metadata: Metadata = { title: "Editor" };
export default function Page() { return <Suspense fallback={<div className="page-wrapper"><SkeletonRows /></div>}><EditorClient /></Suspense>; }
