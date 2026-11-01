/**
 * SQL statement classification: is this batch a read, a write, or DDL?
 *
 * This is the *fast, legible* half of read-only enforcement. It exists so a
 * read-only connection answers `UPDATE users …` with "this connection is
 * read-only" instead of a driver exception forty lines deep, and so the UI can
 * grey out Run before you press it.
 *
 * It is **not** the guarantee. The guarantee is `BEGIN READ ONLY` on the
 * server, which holds whatever this parser missed. Treat a classifier bug as a
 * UX bug, never as a breach — and keep it that way by never letting the engine
 * layer skip its own transaction mode because the classifier said "read".
 *
 * `unknown` fails closed: anything unrecognised is refused on a read-only
 * connection. A parser that guesses "probably fine" is worse than useless.
 */

export type DbStatementKind = "read" | "write" | "ddl" | "unknown";

export interface DbStatement {
  /** The statement text as written, trimmed, comments intact. */
  sql: string;
  kind: DbStatementKind;
  /** Offsets into the original batch, so the editor can highlight the offender. */
  start: number;
  end: number;
  /** Why it got this kind, when the leading keyword doesn't say it. */
  reason?: string;
}

export interface DbBatch {
  statements: DbStatement[];
  /** The most permissive kind required to run the batch. */
  kind: DbStatementKind;
}

/**
 * Strip comments and blank out literals, keeping every offset intact.
 *
 * Offsets have to survive because the statement boundaries computed here are
 * reported back to the editor. Replacing a five-character string with a
 * one-character placeholder would shift every later statement, so literals are
 * overwritten in place with spaces.
 */
function blankLiterals(sql: string): string {
  const out = sql.split("");
  const n = sql.length;
  let i = 0;

  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) {
      // Newlines stay, so line comments still terminate and line numbers hold.
      if (out[k] !== "\n") out[k] = " ";
    }
  };

  while (i < n) {
    const c = sql[i];

    if (c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      const stop = nl === -1 ? n : nl;
      blank(i, stop);
      i = stop;
      continue;
    }

    // Block comments nest in Postgres, so count depth rather than finding the
    // first close.
    if (c === "/" && sql[i + 1] === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") {
          depth++;
          j += 2;
        } else if (sql[j] === "*" && sql[j + 1] === "/") {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      blank(i, j);
      i = j;
      continue;
    }

    // Dollar-quoted body: $$ … $$ or $tag$ … $tag$. Function bodies live here,
    // and they are full of keywords that must not be scanned.
    if (c === "$") {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const delim = tag[0];
        const close = sql.indexOf(delim, i + delim.length);
        const stop = close === -1 ? n : close + delim.length;
        blank(i, stop);
        i = stop;
        continue;
      }
    }

    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") {
          j++;
          break;
        } else j++;
      }
      blank(i, j);
      i = j;
      continue;
    }

    // Quoted identifiers are blanked too: a column named "delete" must not read
    // as the DELETE keyword.
    if (c === '"' || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (sql[j] === quote && sql[j + 1] === quote) j += 2;
        else if (sql[j] === quote) {
          j++;
          break;
        } else j++;
      }
      blank(i, j);
      i = j;
      continue;
    }

    i++;
  }

  return out.join("");
}

export interface SqlStatementSpan {
  sql: string;
  start: number;
  end: number;
}

/** Split on semicolons that are not inside a literal or a comment. */
export function splitSqlStatements(sql: string): SqlStatementSpan[] {
  const masked = blankLiterals(sql);
  const parts: SqlStatementSpan[] = [];
  let from = 0;

  const push = (start: number, end: number) => {
    // A fragment that is only comments and whitespace is not a statement.
    if (!masked.slice(start, end).trim()) return;
    const raw = sql.slice(start, end);
    const offset = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (!trimmed) return;
    parts.push({ sql: trimmed, start: start + offset, end: start + offset + trimmed.length });
  };

  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === ";") {
      push(from, i);
      from = i + 1;
    }
  }
  push(from, sql.length);
  return parts;
}

/** Bare words, uppercased, from text that already had literals and comments removed. */
function keywords(masked: string): string[] {
  return masked
    .split(/[^A-Za-z_]+/)
    .filter(Boolean)
    .map((w) => w.toUpperCase());
}

const DDL_HEADS = new Set([
  "CREATE",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "COMMENT",
  "REINDEX",
  "VACUUM",
  "CLUSTER",
  "SECURITY",
  "RENAME",
]);

const WRITE_HEADS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE", "REPLACE", "UPSERT", "IMPORT"]);

const READ_HEADS = new Set(["SELECT", "TABLE", "VALUES", "SHOW", "DESCRIBE", "DESC"]);

/** Modifies data wherever it appears, including inside a CTE body. */
const DATA_MODIFYING = new Set(["INSERT", "UPDATE", "DELETE", "MERGE"]);

/**
 * DevHub owns the transaction. A hand-written BEGIN/COMMIT would either nest
 * inside our READ ONLY block or end it early and leave later statements running
 * unguarded, so these are refused rather than passed through.
 */
const TRANSACTION_CONTROL = new Set([
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "START",
  "END",
  "RELEASE",
  "PREPARE",
]);

export function classifySqlStatement(sql: string): { kind: DbStatementKind; reason?: string } {
  const words = keywords(blankLiterals(sql));
  if (words.length === 0) return { kind: "unknown", reason: "Empty statement." };

  // EXPLAIN is only a read when it doesn't run the thing. `EXPLAIN ANALYZE
  // DELETE …` really deletes, so classify by the inner statement instead.
  if (words[0] === "EXPLAIN") {
    if (!words.includes("ANALYZE")) return { kind: "read" };
    const innerAt = words.findIndex(
      (w, idx) =>
        idx > 0 && (READ_HEADS.has(w) || WRITE_HEADS.has(w) || DDL_HEADS.has(w) || w === "WITH"),
    );
    if (innerAt === -1) return { kind: "read" };
    const inner = classifyHead(words[innerAt], words.slice(innerAt));
    if (inner.kind === "read") return { kind: "read" };
    return { kind: inner.kind, reason: "EXPLAIN ANALYZE executes the statement it explains." };
  }

  return classifyHead(words[0], words);
}

function classifyHead(head: string, words: string[]): { kind: DbStatementKind; reason?: string } {
  if (TRANSACTION_CONTROL.has(head)) {
    return {
      kind: "unknown",
      reason: "DevHub manages the transaction — remove BEGIN / COMMIT / ROLLBACK.",
    };
  }

  // Standalone ANALYZE is maintenance; ANALYZE inside EXPLAIN never reaches here.
  if (head === "ANALYZE") return { kind: "ddl" };

  if (head === "WITH") {
    // The mutation can hide in the CTE body: WITH d AS (DELETE … RETURNING *) SELECT …
    const modifier = words.find((w) => DATA_MODIFYING.has(w));
    if (modifier) return { kind: "write", reason: `The CTE contains ${modifier}.` };
    return { kind: "read" };
  }

  if (head === "SELECT") {
    // SELECT … INTO creates a table (and in PL/pgSQL assigns a variable).
    // Neither belongs on a read connection.
    if (words.includes("INTO")) return { kind: "ddl", reason: "SELECT … INTO creates a table." };
    const forAt = words.indexOf("FOR");
    if (forAt !== -1 && words.slice(forAt + 1, forAt + 4).some((w) => w === "UPDATE" || w === "SHARE")) {
      return { kind: "write", reason: "SELECT … FOR UPDATE/SHARE takes row locks." };
    }
    return { kind: "read" };
  }

  if (head === "COPY") {
    if (words.includes("FROM")) return { kind: "write", reason: "COPY … FROM loads data." };
    if (words.includes("TO") && words.includes("STDOUT")) return { kind: "read" };
    return { kind: "unknown", reason: "COPY to or from a server-side file is not supported." };
  }

  if (head === "REFRESH") {
    return { kind: "write", reason: "REFRESH MATERIALIZED VIEW rewrites the view." };
  }
  if (head === "DO" || head === "CALL") {
    return { kind: "unknown", reason: `${head} can do anything; DevHub cannot classify it.` };
  }
  if (head === "SET" || head === "RESET") {
    return { kind: "unknown", reason: "Session settings are managed by DevHub." };
  }

  if (READ_HEADS.has(head)) return { kind: "read" };
  if (WRITE_HEADS.has(head)) return { kind: "write" };
  if (DDL_HEADS.has(head)) return { kind: "ddl" };

  return { kind: "unknown", reason: `Unrecognised statement starting with ${head}.` };
}

/** Ordered least- to most-restricted, so a batch takes the kind of its strongest statement. */
const RANK: Record<DbStatementKind, number> = { read: 0, write: 1, ddl: 2, unknown: 3 };

export function classifySqlBatch(sql: string): DbBatch {
  const statements: DbStatement[] = splitSqlStatements(sql).map((part) => {
    const { kind, reason } = classifySqlStatement(part.sql);
    return { ...part, kind, reason };
  });
  const kind = statements.reduce<DbStatementKind>(
    (worst, s) => (RANK[s.kind] > RANK[worst] ? s.kind : worst),
    "read",
  );
  return { statements, kind };
}

/**
 * The statement that would be refused on a read-only connection, or null.
 * Returns the statement rather than a boolean so the caller can name it.
 */
export function firstNonReadStatement(batch: DbBatch): DbStatement | null {
  return batch.statements.find((s) => s.kind !== "read") ?? null;
}
