import { RouteLoading } from "@/components/ui/RouteLoading";

export default function Loading() {
  return <RouteLoading {...{ rows: 4, variant: "block" }} />;
}
