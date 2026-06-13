import type { Metadata } from "next";
import Client from "./client";

export const metadata: Metadata = { title: "Work" };

export default function Page() {
  return <Client />;
}
