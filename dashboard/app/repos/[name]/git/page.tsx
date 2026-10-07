import { Suspense } from "react";
import { SkeletonRows } from "@/components";
import { RepoGitPage } from "./client";

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return { title: name };
}

export default async function Page({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return (
    <Suspense
      fallback={
        <div className="page-wrapper">
          <SkeletonRows count={6} />
        </div>
      }
    >
      <RepoGitPage name={name} />
    </Suspense>
  );
}
