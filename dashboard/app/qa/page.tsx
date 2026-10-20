import { Suspense } from "react";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import QaClient from "./client";
export const metadata = { title: "QA lab" };
export default function Page() { return <Suspense fallback={<SkeletonRows count={5} height={48} />}><QaClient /></Suspense>; }
