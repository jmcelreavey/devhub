import type { Metadata } from "next";
import Client from "./client";

export const metadata: Metadata = { title: "1:1" };

export default function Page() {
  return <Client />;
}
