"use client";

import { Columns3, KeyRound, Link2, ScrollText, ShieldCheck } from "lucide-react";
import { CardSection } from "@/components/ui/CardSection";
import { EmptyState } from "@/components/ui/EmptyState";
import { CopyButton } from "@/components/ui/CopyButton";
import { formatRowCount } from "./shared";
import type { DbTablePayload } from "./shared";

interface StructurePanelProps {
  detail: DbTablePayload;
}

/**
 * Columns, indexes, keys and DDL for one table or collection.
 *
 * The Mongo caveat is load-bearing rather than decorative: its column list is
 * inferred from a document sample, so showing it in the same table as a
 * Postgres schema without saying so would be a lie the user then acts on.
 */
export function StructurePanel({ detail }: StructurePanelProps) {
  return (
    <div className="db-structure">
      {detail.inferred && (
        <p className="tone-panel tone-panel--muted db-structure-note">
          MongoDB does not enforce a schema. These fields are what appeared in a sample of{" "}
          {detail.sampleSize ?? 0} documents — not a guarantee about the rest of the collection.
        </p>
      )}

      <CardSection
        title="Columns"
        icon={<Columns3 size={14} />}
        rightElement={
          detail.estimatedRows !== undefined ? (
            <span className="badge badge-muted">~{formatRowCount(detail.estimatedRows)} rows</span>
          ) : undefined
        }
      >
        {detail.columns.length === 0 ? (
          <EmptyState title="No columns" subtitle="Nothing to describe here." bare />
        ) : (
          <table className="db-meta-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Type</th>
                {/* For Mongo this column means "present in every sampled
                    document", which is a different question from nullability. */}
                <th scope="col">{detail.inferred ? "In every doc" : "Nullable"}</th>
                <th scope="col">Default</th>
              </tr>
            </thead>
            <tbody>
              {detail.columns.map((column) => (
                <tr key={column.name}>
                  <td>
                    <span className="db-meta-name">{column.name}</span>
                    {column.primaryKey && <span className="badge badge-accent">key</span>}
                  </td>
                  <td className="db-meta-mono">{column.dataType}</td>
                  <td>
                    {detail.inferred
                      ? column.nullable
                        ? "no"
                        : "yes"
                      : column.nullable
                        ? "yes"
                        : "no"}
                  </td>
                  <td className="db-meta-mono">{column.defaultValue ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardSection>

      <CardSection title="Indexes" icon={<KeyRound size={14} />}>
        {detail.indexes.length === 0 ? (
          <EmptyState title="No indexes" subtitle="Nothing beyond the heap." bare />
        ) : (
          <table className="db-meta-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Columns</th>
                <th scope="col">Unique</th>
              </tr>
            </thead>
            <tbody>
              {detail.indexes.map((index) => (
                <tr key={index.name}>
                  <td>
                    <span className="db-meta-name">{index.name}</span>
                    {index.primary && <span className="badge badge-accent">primary</span>}
                  </td>
                  <td className="db-meta-mono">{index.columns.join(", ") || "—"}</td>
                  <td>{index.unique ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardSection>

      {(detail.foreignKeys.length > 0 || detail.referencedBy.length > 0) && (
        <CardSection title="Relations" icon={<Link2 size={14} />}>
          <ul className="db-relations">
            {detail.foreignKeys.map((fk) => (
              <li key={`out-${fk.name}`}>
                <span className="db-meta-mono">{fk.columns.join(", ")}</span>
                {" → "}
                <span className="db-meta-mono">
                  {fk.referencedNamespace}.{fk.referencedTable} ({fk.referencedColumns.join(", ")})
                </span>
                {fk.onDelete && fk.onDelete !== "NO ACTION" && (
                  <span className="badge badge-muted">on delete {fk.onDelete.toLowerCase()}</span>
                )}
              </li>
            ))}
            {detail.referencedBy.map((fk) => (
              <li key={`in-${fk.name}`} className="db-relation-inbound">
                <span className="db-meta-mono">
                  {fk.referencedNamespace}.{fk.referencedTable} ({fk.columns.join(", ")})
                </span>
                <span className="badge badge-muted">references this</span>
              </li>
            ))}
          </ul>
        </CardSection>
      )}

      {detail.constraints.length > 0 && (
        <CardSection title="Constraints" icon={<ShieldCheck size={14} />}>
          <ul className="db-relations">
            {detail.constraints.map((constraint) => (
              <li key={constraint.name}>
                <span className="db-meta-name">{constraint.name}</span>
                <span className="badge badge-muted">{constraint.kind}</span>
                <code className="db-meta-mono">{constraint.definition}</code>
              </li>
            ))}
          </ul>
        </CardSection>
      )}

      {detail.ddl && (
        <CardSection
          title="DDL"
          icon={<ScrollText size={14} />}
          rightElement={<CopyButton text={detail.ddl} label="Copy DDL" />}
        >
          <pre className="db-ddl">{detail.ddl}</pre>
        </CardSection>
      )}

      {/* Two different reasons editing is off, and the user should know which. */}
      {!detail.editable && detail.notEditableReason && (
        <p className="tone-panel tone-panel--muted db-structure-note">
          Rows here cannot be edited: {detail.notEditableReason}
        </p>
      )}
      {detail.editable && detail.identity && (
        <p className="db-structure-note db-structure-note--quiet">{detail.identity.description}</p>
      )}
    </div>
  );
}
