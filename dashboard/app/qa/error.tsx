"use client";
import { FetchError } from "@/components/ui/FetchError";
export default function ErrorPage({ reset }: { reset: () => void }) { return <FetchError message="Couldn’t load the QA lab. Retry to reload the run history." onRetry={reset} />; }
