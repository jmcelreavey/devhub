import { redirect } from "next/navigation";

export default async function Page({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run } = await searchParams;
  redirect(run ? `/agents?run=${encodeURIComponent(run)}` : "/agents");
}
