import { Suspense } from "react";
import type { Metadata } from "next";
import Client from "./client";

export const metadata: Metadata = { title: "Tasks" };

export default function Page() {
  return (
    <Suspense fallback={<div className="page-wrapper" />}>
      <Client />
    </Suspense>
  );
}
