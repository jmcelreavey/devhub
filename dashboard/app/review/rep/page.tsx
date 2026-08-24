import type { Metadata } from "next";
import Client from "./client";

export const metadata: Metadata = { title: "Daily rep" };

export default function Page() {
  return <Client />;
}
