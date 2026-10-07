import { Suspense } from "react";
import Client from "./client";
import Loading from "./loading";

export const metadata = { title: "System" };

export default function Page() {
  return <Suspense fallback={<Loading />}><Client /></Suspense>;
}
