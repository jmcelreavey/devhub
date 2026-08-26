import { redirect } from "next/navigation";

export const metadata = { title: "Owned repos" };

export default function Page() {
  redirect("/repos?view=owned");
}
