import { Suspense } from "react";
import Client from "./client";
import Loading from "./loading";

export const metadata = { title: "Settings" };

export default function Page() {
  return <Suspense fallback={<Loading />}><Client /></Suspense>;
}
