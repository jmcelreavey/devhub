import { LearnScreen } from "./client";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ lab?: string }>;
}) {
  const [{ name }, { lab }] = await Promise.all([params, searchParams]);
  return <LearnScreen name={decodeURIComponent(name)} focusLab={lab?.trim() || undefined} />;
}
