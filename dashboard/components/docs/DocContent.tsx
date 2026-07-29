import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ExternalLink,
  Flame,
  Info,
  Lightbulb,
  Link2,
  OctagonAlert,
} from "lucide-react";
import { DocCodeBlock } from "@/components/docs/DocCodeBlock";
import { DocMermaid } from "@/components/docs/DocMermaid";
import type {
  CalloutVariant,
  DocNode,
  InlineNode,
} from "@/lib/docs/markdown-ast";

/**
 * Renders a parsed docs AST.
 *
 * Server component by default — only code blocks and mermaid diagrams need the
 * client, and they opt in individually. Everything is plain semantic HTML with
 * `docs-*` classes; the styling lives in globals.css next to the rest of the
 * design system rather than as inline Tailwind soup.
 */

function isExternal(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("mailto:");
}

function Inline({ nodes }: { nodes: InlineNode[] }): ReactNode {
  return nodes.map((node, i) => {
    if (node.type === "image") {
      // eslint-disable-next-line @next/next/no-img-element
      return <img key={i} src={node.src} alt={node.alt} className="docs-inline-image" />;
    }
    if (node.type === "link") {
      const external = isExternal(node.href);
      const inner = <Inline nodes={node.children} />;
      if (external) {
        return (
          <a
            key={i}
            href={node.href}
            target="_blank"
            rel="noreferrer noopener"
            className="docs-link docs-link-external"
          >
            {inner}
            <ExternalLink size={11} aria-hidden />
          </a>
        );
      }
      return (
        <Link key={i} href={node.href} className="docs-link">
          {inner}
        </Link>
      );
    }

    let out: ReactNode = node.value;
    if (node.styles.code) out = <code className="docs-inline-code">{out}</code>;
    if (node.styles.strike) out = <del>{out}</del>;
    if (node.styles.italic) out = <em>{out}</em>;
    if (node.styles.bold) out = <strong>{out}</strong>;
    return <span key={i}>{out}</span>;
  });
}

const CALLOUT_META: Record<
  CalloutVariant,
  { label: string; Icon: typeof Info }
> = {
  note: { label: "Note", Icon: Info },
  tip: { label: "Tip", Icon: Lightbulb },
  important: { label: "Important", Icon: Flame },
  warning: { label: "Warning", Icon: AlertTriangle },
  caution: { label: "Caution", Icon: OctagonAlert },
};

function Heading({ node }: { node: Extract<DocNode, { type: "heading" }> }) {
  const Tag = `h${node.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <Tag id={node.id} className="docs-heading" data-level={node.level}>
      <a href={`#${node.id}`} className="docs-anchor" aria-label={`Link to ${node.text}`}>
        <Link2 size={13} aria-hidden />
      </a>
      <Inline nodes={node.content} />
    </Tag>
  );
}

function NodeView({ node }: { node: DocNode }): ReactNode {
  switch (node.type) {
    case "heading":
      return <Heading node={node} />;

    case "paragraph":
      return (
        <p className="docs-paragraph">
          <Inline nodes={node.content} />
        </p>
      );

    case "list": {
      const items = node.items.map((item, i) => (
        <li key={i} className={item.checked === undefined ? undefined : "docs-task-item"}>
          {item.checked === undefined ? null : (
            <input
              type="checkbox"
              checked={item.checked}
              readOnly
              tabIndex={-1}
              aria-hidden
              className="docs-task-checkbox"
            />
          )}
          <span className="docs-list-text">
            <Inline nodes={item.content} />
          </span>
          {item.children.length > 0 ? <DocContent nodes={item.children} /> : null}
        </li>
      ));
      return node.ordered ? (
        <ol className="docs-list" start={node.start}>
          {items}
        </ol>
      ) : (
        <ul className="docs-list">{items}</ul>
      );
    }

    case "code":
      return <DocCodeBlock lang={node.lang} value={node.value} />;

    case "mermaid":
      return <DocMermaid code={node.code} />;

    case "blockquote":
      return (
        <blockquote className="docs-quote">
          <DocContent nodes={node.children} />
        </blockquote>
      );

    case "callout": {
      const { label, Icon } = CALLOUT_META[node.variant];
      return (
        <aside className="docs-callout" data-variant={node.variant}>
          <div className="docs-callout-head">
            <Icon size={14} aria-hidden />
            <span>{node.title || label}</span>
          </div>
          <div className="docs-callout-body">
            <DocContent nodes={node.children} />
          </div>
        </aside>
      );
    }

    case "table":
      return (
        <div className="docs-table-scroll">
          <table className="docs-table">
            <thead>
              <tr>
                {node.header.map((cell, i) => (
                  <th key={i} style={{ textAlign: node.align[i] ?? undefined }}>
                    <Inline nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={{ textAlign: node.align[c] ?? undefined }}>
                      <Inline nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "image":
      return (
        <figure className="docs-figure">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={node.src} alt={node.alt} className="docs-image" />
          {node.alt ? <figcaption className="docs-figure-caption">{node.alt}</figcaption> : null}
        </figure>
      );

    case "video":
      return (
        <figure className="docs-figure">
          <video controls preload="metadata" playsInline className="docs-video">
            <source src={node.src} type="video/mp4" />
          </video>
          <figcaption className="docs-figure-caption">{node.title}</figcaption>
        </figure>
      );

    case "divider":
      return <hr className="docs-divider" />;

    default:
      return null;
  }
}

export function DocContent({ nodes }: { nodes: DocNode[] }) {
  return (
    <>
      {nodes.map((node, i) => (
        <NodeView key={i} node={node} />
      ))}
    </>
  );
}
