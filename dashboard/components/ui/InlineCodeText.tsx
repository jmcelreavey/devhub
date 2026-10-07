import { Fragment } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { looksLikeCommand, splitInlineCode } from "@/lib/text/inline-code";

/**
 * Plain text where `backtick` spans render as inline code. Commands (a program
 * and its arguments) get a copy button when `copyCommands` is set.
 */
export function InlineCodeText({ text, copyCommands = false }: { text: string; copyCommands?: boolean }) {
  return <>{splitInlineCode(text).map((segment, index) => segment.kind === "text"
    ? <Fragment key={index}>{segment.text}</Fragment>
    : <Fragment key={index}>
      <code className="px-1 py-0.5 rounded bg-bg text-[0.95em] break-words">{segment.text}</code>
      {copyCommands && looksLikeCommand(segment.text) && <CopyButton text={segment.text} label={segment.text} />}
    </Fragment>)}</>;
}
