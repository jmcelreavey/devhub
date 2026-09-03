/**
 * The shape of a database, described the same way whatever the engine.
 *
 * The three engines disagree about almost everything — Postgres has schemas and
 * real types, Mongo has neither and infers its shape from samples, SQLite has
 * one namespace and stores its DDL as text. This is the common denominator the
 * UI renders, with engine-specific detail carried in optional fields rather
 * than in three parallel component trees.
 *
 * Pure types, safe to import from client components.
 */

export interface DbNamespace {
  /** Postgres schema, Mongo database, or "main" for SQLite. */
  name: string;
  /** Owned by the system rather than the user — collapsed by default. */
  system: boolean;
}

export type DbObjectKind = "table" | "view" | "materialized-view" | "collection";

export interface DbObjectSummary {
  namespace: string;
  name: string;
  kind: DbObjectKind;
  /**
   * Approximate row count. Deliberately approximate: an exact `count(*)` on a
   * large prd table is a slow query nobody asked for, so this comes from the
   * planner's estimate (Postgres `reltuples`, Mongo `$collStats`).
   */
  estimatedRows?: number;
  /** On-disk size in bytes, when the engine reports one cheaply. */
  sizeBytes?: number;
  comment?: string;
}

export interface DbColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue?: string;
  /** Ordinal position, 1-based, so the UI can show columns in table order. */
  position: number;
  primaryKey: boolean;
  comment?: string;
}

export interface DbIndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  /** Engine-native definition, shown verbatim — partial indexes matter. */
  definition?: string;
}

export interface DbForeignKeyInfo {
  name: string;
  columns: string[];
  referencedNamespace: string;
  referencedTable: string;
  referencedColumns: string[];
  onDelete?: string;
  onUpdate?: string;
}

export interface DbConstraintInfo {
  name: string;
  kind: "check" | "unique" | "primary" | "exclude";
  definition: string;
}

export interface DbObjectDetail {
  namespace: string;
  name: string;
  kind: DbObjectKind;
  columns: DbColumnInfo[];
  indexes: DbIndexInfo[];
  foreignKeys: DbForeignKeyInfo[];
  constraints: DbConstraintInfo[];
  /** Tables that reference this one — the other half of the relations view. */
  referencedBy: DbForeignKeyInfo[];
  /** CREATE statement, composed or read from the engine. */
  ddl?: string;
  estimatedRows?: number;
  comment?: string;
  /**
   * For Mongo: the column list is inferred from a sample, so the UI must say so
   * rather than presenting it as a schema the database is enforcing.
   */
  inferred?: boolean;
  /** How many documents the inference looked at. */
  sampleSize?: number;
}
