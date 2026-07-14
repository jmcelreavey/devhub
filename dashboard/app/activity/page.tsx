import { redirect } from "next/navigation";

export default function ActivityPage() {
  redirect("/work?tab=tasks");
}
