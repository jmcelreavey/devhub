import { redirect } from "next/navigation";
import { isDesktopRuntime } from "@/lib/desktop/runtime-paths";
import { readSetupProgress } from "@/lib/setup/first-run";
import { HomePage } from "@/components/home/HomeWorkSummary";
import { legacyTodayHref } from "@/lib/home-redirect";

export const metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  if (isDesktopRuntime() && !readSetupProgress().completed) redirect("/setup");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams ?? {})) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }
  const href = legacyTodayHref(params.toString());
  if (href) redirect(href);
  return <HomePage />;
}
