/**
 * The SQLite runner body, as source, executed in a **child process**.
 *
 * ## Why SQLite is isolated at all
 *
 * `node:sqlite` is synchronous. A slow statement on the main thread does not
 * make one route slow — it stops the event loop, which is the failure this
 * codebase has already paid for once (`exec-external.ts` exists because a
 * single un-timed subprocess held every route for fourteen minutes). A
 * synchronous database call is that same failure with no subprocess to blame.
 *
 * ## Why a process and not a worker thread
 *
 * A worker thread was the obvious choice and it is the wrong one. `node:sqlite`
 * exposes no `interrupt()`, so the only bound on a runaway statement is killing
 * whatever is running it — and `worker.terminate()` cannot kill a thread parked
 * in a synchronous C call. V8 terminates execution at JS safepoints, and a
 * recursive-CTE scan reaches none.
 *
 * Measured, not assumed: `terminate()` on a thread running
 * `WITH RECURSIVE spin(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM spin)
 * SELECT count(*) FROM spin` never resolved, and the host process could not
 * exit afterwards — `process.exit()` included. One such query would have
 * wedged the dashboard permanently, which is precisely the outcome the
 * isolation was meant to prevent.
 *
 * A child process has an answer a thread does not: SIGKILL. That is the same
 * reasoning `execExternal` records — "SIGKILL rather than SIGTERM because the
 * processes worth killing here are the ones ignoring polite requests."
 *
 * ## Why source-as-a-string rather than a file
 *
 * The dashboard is bundled by Next. A script path has to survive dev,
 * `next build --turbopack`, the standalone output *and* the packaged desktop
 * app, and Next's file tracing does not follow a path handed to `spawn` at
 * runtime — so it would work in dev and break in the installed app, which is
 * the worst place to find out. `node -e <source>` sidesteps bundling entirely.
 *
 * The cost is real and worth naming: this body is a string, so TypeScript does
 * not check it. It is kept small and deliberately dull, and `adapter.test.ts`
 * exercises it against a real database file rather than a mock — the compiler
 * is not checking this, so the tests have to.
 *
 * The source is this module constant, never anything a caller supplies.
 * Statements arrive afterwards, as IPC messages.
 */
export const SQLITE_RUNNER_SOURCE = String.raw`
const { DatabaseSync } = require("node:sqlite");

let db = null;
let openError = null;

process.on("message", (request) => {
  // The first message carries the file to open; every later one is a statement.
  if (request.type === "open") {
    try {
      db = new DatabaseSync(request.file, { readOnly: request.readOnly });
      process.send({ id: request.id, ok: true });
    } catch (err) {
      openError = "Could not open " + request.file + ": " + err.message;
      process.send({ id: request.id, ok: false, error: openError });
    }
    return;
  }

  if (!db) {
    process.send({ id: request.id, ok: false, error: openError || "SQLite is not open." });
    return;
  }

  // Staged grid edits: several parameterised statements, all or nothing.
  // Values are bound, never interpolated — a cell value must not become SQL.
  if (request.type === "transaction") {
    try {
      db.exec("BEGIN");
      const rowsAffected = [];
      for (const st of request.statements) {
        const changes = Number(db.prepare(st.sql).run(...st.params).changes);
        if (changes !== 1) {
          throw new Error(
            changes === 0
              ? "A row changed since it was loaded, so nothing was applied. Re-run the query and try again."
              : "A statement matched " + changes + " rows instead of 1, so nothing was applied. The row identity is not unique.",
          );
        }
        rowsAffected.push(changes);
      }
      db.exec("COMMIT");
      process.send({ id: request.id, ok: true, rowsAffectedList: rowsAffected });
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch (_) { /* already rolled back */ }
      process.send({ id: request.id, ok: false, error: err.message });
    }
    return;
  }

  try {
    const prepared = db.prepare(request.statement);

    // Integers past 2^53 throw on read unless BigInts are requested, so a table
    // with a large INTEGER key would fail to render at all rather than render
    // imprecisely. The adapter stringifies them on the way out.
    if (typeof prepared.setReadBigInts === "function") prepared.setReadBigInts(true);

    // Ask the statement whether it returns rows rather than pattern-matching
    // the SQL — a CTE ending in RETURNING is not distinguishable by prefix.
    const columns = prepared.columns();

    if (columns.length === 0) {
      const result = prepared.run();
      process.send({
        id: request.id,
        ok: true,
        columns: [{ name: "changes" }],
        rows: [[Number(result.changes)]],
        rowsAffected: Number(result.changes),
        truncated: false,
      });
      return;
    }

    const names = columns.map((c) => c.name);
    const all = prepared.all();
    const truncated = all.length > request.rowLimit;
    const rows = (truncated ? all.slice(0, request.rowLimit) : all).map((row) =>
      names.map((name) => {
        const value = row[name];
        if (value === null || value === undefined) return null;
        if (typeof value === "bigint") {
          // Only stringify when it genuinely does not fit — otherwise every
          // ordinary id comes back as a string and sorts like one.
          return value >= -9007199254740991n && value <= 9007199254740991n
            ? Number(value)
            : value.toString();
        }
        if (value instanceof Uint8Array) return "\\x" + Buffer.from(value).toString("hex");
        return value;
      }),
    );

    process.send({
      id: request.id,
      ok: true,
      columns: columns.map((c) => ({ name: c.name, dataType: c.type || undefined })),
      rows,
      truncated,
    });
  } catch (err) {
    process.send({ id: request.id, ok: false, error: err.message });
  }
});
`;
