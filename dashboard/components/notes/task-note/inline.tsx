import type { ReactNode } from "react";
import { safeLinkHref } from "@shared/task-note/meta.ts";
import type { InlineNode } from "@shared/task-note/sections.ts";

/** Render BlockNote inline content (bold, italic, code, links) as React. Unsafe hrefs render as text. */
export function renderInline(nodes: InlineNode[] | undefined): ReactNode {
  return (nodes ?? []).map((node, index) => {
    if (node.type === "link") {
      const href = safeLinkHref(node.href);
      const label = renderInline(node.content);
      if (!href) return <span key={index}>{label}</span>;
      const external = !href.startsWith("/");
      return (
        <a key={index} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {label}
        </a>
      );
    }
    let out: ReactNode = node.text ?? "";
    const styles = node.styles ?? {};
    if (styles.code) out = <code>{out}</code>;
    if (styles.bold) out = <strong>{out}</strong>;
    if (styles.italic) out = <em>{out}</em>;
    if (styles.strike) out = <s>{out}</s>;
    return <span key={index}>{out}</span>;
  });
}
