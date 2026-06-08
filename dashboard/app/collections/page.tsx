import { redirect } from "next/navigation";
import { notesChecklistsHref } from "@/lib/checklists/notes-url";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ notePath?: string; scope?: string }>;
}) {
  const params = await searchParams;
  redirect(
    notesChecklistsHref({
      notePath: params.notePath,
      scope: params.scope,
    }),
  );
}
