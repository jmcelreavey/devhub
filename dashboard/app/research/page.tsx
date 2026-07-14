import type { Metadata } from "next";
import Client from "./client";

export const metadata: Metadata = { title: "Research" };

export default function Page() {
  return <Client />;
}
