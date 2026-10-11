import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import BrowserClient from "./client";
export const metadata: Metadata = { title: "Browser" };
export default function Page() { return <Suspense fallback={<PageSkeleton />}><BrowserClient /></Suspense>; }
