import { redirect } from "next/navigation";

/** /tickets is extinct — /work is canonical (Jira tab). */
export default function TicketsRedirectPage() {
  redirect("/work?tab=jira");
}
