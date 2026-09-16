import { Suspense } from "react";
import Client from "./client";

export const metadata = { title: "Agent activity" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Client />
    </Suspense>
  );
}
