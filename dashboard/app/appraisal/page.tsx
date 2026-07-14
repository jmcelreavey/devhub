import type { Metadata } from "next";
import Client from "./client";

export const metadata: Metadata = { title: "Appraisal" };

export default function Page() {
  return <Client />;
}
