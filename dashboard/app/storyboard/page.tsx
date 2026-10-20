import { Suspense } from "react";
import type { Metadata } from "next";
import { RouteLoading } from "@/components/ui/RouteLoading";
import StoryboardClient from "./client";

export const metadata: Metadata = { title: "Storyboard" };

export default function Page() {
  return <Suspense fallback={<RouteLoading />}><StoryboardClient /></Suspense>;
}
