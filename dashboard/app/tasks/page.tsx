import { redirect } from "next/navigation";

/** /tasks is extinct — /work is canonical (tasks tab). */
export default function TasksRedirectPage() {
  redirect("/work?tab=tasks");
}
