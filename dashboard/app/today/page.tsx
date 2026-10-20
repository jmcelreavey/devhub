import { redirect } from "next/navigation";
import { legacyTodayHref } from "@/lib/home-redirect";

export default async function TodayAlias({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }
  redirect(legacyTodayHref(params.toString(), "", true)!);
}
