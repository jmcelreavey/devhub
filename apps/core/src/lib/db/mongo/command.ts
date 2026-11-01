/**
 * Parsing and classifying MongoDB commands.
 *
 * MongoDB has no SQL, so "what statement did the user write" needs deciding
 * rather than inheriting. Two accepted forms:
 *
 * 1. **Shell shorthand** — `db.posts.find({ status: "published" }).limit(10)`.
 *    What people already type into `mongosh`, so it is what they type here.
 * 2. **A JSON command document** — `{ "collection": "posts", "operation":
 *    "find", "filter": { … } }`. The canonical form, and what the shorthand
 *    parses into.
 *
 * **The shorthand is parsed, never evaluated.** Running `db.posts.find(…)`
 * through anything JS-evaluating would hand whoever wrote the statement — an
 * agent, a pasted snippet — arbitrary code execution in the dashboard process.
 * So this reads the argument text and parses it as (relaxed) JSON, and a
 * construct it cannot parse is refused rather than guessed at.
 *
 * Read-only enforcement is an **allowlist**, not a denylist. MongoDB has no
 * `BEGIN READ ONLY`, so the property has to come from never issuing a mutating
 * command at all — which means an unrecognised operation must be refused, not
 * permitted. `$out` and `$merge` get their own check because they turn a
 * perfectly innocent-looking `aggregate` into a write.
 */

export type MongoOperation =
  | "find"
  | "findOne"
  | "aggregate"
  | "countDocuments"
  | "estimatedDocumentCount"
  | "distinct"
  | "listCollections"
  | "listIndexes"
  | "insertOne"
  | "insertMany"
  | "updateOne"
  | "updateMany"
  | "replaceOne"
  | "deleteOne"
  | "deleteMany"
  | "createIndex"
  | "dropIndex"
  | "drop";

/** Operations that cannot modify data. Anything not here is treated as a write. */
export const MONGO_READ_OPERATIONS: ReadonlySet<MongoOperation> = new Set([
  "find",
  "findOne",
  "aggregate",
  "countDocuments",
  "estimatedDocumentCount",
  "distinct",
  "listCollections",
  "listIndexes",
]);

/** Operations that change the schema rather than the data. */
export const MONGO_DDL_OPERATIONS: ReadonlySet<MongoOperation> = new Set([
  "createIndex",
  "dropIndex",
  "drop",
]);

const ALL_OPERATIONS = new Set<string>([
  ...MONGO_READ_OPERATIONS,
  ...MONGO_DDL_OPERATIONS,
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "replaceOne",
  "deleteOne",
  "deleteMany",
]);

export interface MongoCommand {
  collection: string;
  operation: MongoOperation;
  /** Query filter, or the match document for update/delete. */
  filter?: Record<string, unknown>;
  /** Aggregation pipeline. */
  pipeline?: Record<string, unknown>[];
  /** Update document or replacement. */
  update?: Record<string, unknown>;
  /** Documents to insert. */
  documents?: Record<string, unknown>[];
  /** Index specification for createIndex; index name for dropIndex. */
  index?: Record<string, unknown> | string;
  projection?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  limit?: number;
  skip?: number;
  /** Field name for `distinct`. */
  field?: string;
}

export type MongoCommandKind = "read" | "write" | "ddl";

export function mongoCommandKind(operation: MongoOperation): MongoCommandKind {
  if (MONGO_READ_OPERATIONS.has(operation)) return "read";
  if (MONGO_DDL_OPERATIONS.has(operation)) return "ddl";
  return "write";
}

export class MongoCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MongoCommandError";
  }
}

/**
 * Parse relaxed JSON: unquoted keys, single-quoted strings, trailing commas.
 *
 * People paste from `mongosh`, from logs, from a colleague's Slack message, and
 * none of those are strict JSON. Rejecting `{ status: 'published' }` for its
 * quoting style would make the shorthand useless.
 *
 * Still a *parser*, not an evaluator: it rewrites text into strict JSON and
 * hands it to `JSON.parse`. Anything it cannot rewrite fails, which is why
 * `ISODate(…)` and `ObjectId(…)` are handled explicitly below rather than by
 * loosening this further.
 */
export function parseRelaxedJson(text: string): unknown {
  const strict = text
    // Preserve string contents while rewriting everything outside them.
    .replace(/'((?:[^'\\]|\\.)*)'/g, (_, body: string) => JSON.stringify(body.replace(/\\'/g, "'")))
    // ObjectId("…") / ISODate("…") → tagged objects the adapter revives.
    .replace(/\bObjectId\(\s*"([0-9a-fA-F]{24})"\s*\)/g, '{"$oid":"$1"}')
    .replace(/\bISODate\(\s*"([^"]*)"\s*\)/g, '{"$date":"$1"}')
    .replace(/\bnew\s+Date\(\s*"([^"]*)"\s*\)/g, '{"$date":"$1"}')
    // Unquoted object keys.
    .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$.]*)\s*:/g, '$1"$2":')
    // Trailing commas.
    .replace(/,(\s*[}\]])/g, "$1");

  try {
    return JSON.parse(strict);
  } catch (err) {
    throw new MongoCommandError(
      `Could not parse the argument as JSON: ${(err as Error).message}. ` +
        `Supported: JSON, single quotes, unquoted keys, ObjectId("…") and ISODate("…").`,
    );
  }
}

/**
 * Split a call's arguments on top-level commas.
 *
 * `find({ a: 1, b: 2 }, { _id: 0 })` has two arguments and three commas, so a
 * plain split is wrong. Tracks bracket depth and string state.
 */
export function splitArguments(text: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === "," && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) args.push(tail);
  return args.filter(Boolean);
}

/** `db.posts.find({…})` → collection `posts`, operation `find`, args `[{…}]`. */
const SHELL_CALL = /^db\s*(?:\.\s*([A-Za-z_][\w.$-]*)|\[\s*["']([^"']+)["']\s*\])\s*\.\s*(\w+)\s*\(/;

/** Chained modifiers: `.limit(10)`, `.sort({…})`, `.skip(5)`, `.projection({…})`. */
const CHAINED = /\.\s*(limit|skip|sort|projection|project)\s*\(([\s\S]*?)\)\s*(?=\.|$|;)/g;

/** Find the index just past the call's closing paren, respecting nesting and strings. */
function matchingParen(text: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function asDocument(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MongoCommandError(`${what} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

/** Parse either accepted form into a command. */
export function parseMongoCommand(statement: string): MongoCommand {
  const trimmed = statement.trim().replace(/;\s*$/, "");
  if (!trimmed) throw new MongoCommandError("Empty command.");

  if (trimmed.startsWith("{")) return fromJsonDocument(parseRelaxedJson(trimmed));
  return fromShellShorthand(trimmed);
}

function fromJsonDocument(parsed: unknown): MongoCommand {
  const doc = asDocument(parsed, "Command");
  const collection = doc.collection;
  const operation = doc.operation;
  if (typeof collection !== "string" || !collection) {
    throw new MongoCommandError('Command needs a "collection" string.');
  }
  if (typeof operation !== "string" || !ALL_OPERATIONS.has(operation)) {
    throw new MongoCommandError(
      `Unknown operation ${JSON.stringify(operation)}. Supported: ${[...ALL_OPERATIONS].sort().join(", ")}.`,
    );
  }
  return { ...(doc as object), collection, operation: operation as MongoOperation } as MongoCommand;
}

function fromShellShorthand(text: string): MongoCommand {
  const head = SHELL_CALL.exec(text);
  if (!head) {
    throw new MongoCommandError(
      'Expected db.<collection>.<operation>(…) or a JSON command document like {"collection":"posts","operation":"find"}.',
    );
  }

  const collection = head[1] ?? head[2];
  const operation = head[3];
  if (!ALL_OPERATIONS.has(operation)) {
    throw new MongoCommandError(
      `Unsupported operation '${operation}'. Supported: ${[...ALL_OPERATIONS].sort().join(", ")}.`,
    );
  }

  const openIndex = text.indexOf("(", head[0].length - 1);
  const closeIndex = matchingParen(text, openIndex);
  if (closeIndex === -1) throw new MongoCommandError("Unbalanced parentheses in the command.");

  const args = splitArguments(text.slice(openIndex + 1, closeIndex)).map(parseRelaxedJson);
  const command: MongoCommand = { collection, operation: operation as MongoOperation };

  applyPositionalArgs(command, args);

  // Chained modifiers appear after the call's closing paren.
  const tail = text.slice(closeIndex + 1);
  for (const match of tail.matchAll(CHAINED)) {
    const [, name, raw] = match;
    const value = raw.trim() ? parseRelaxedJson(raw) : undefined;
    if (name === "limit" && typeof value === "number") command.limit = value;
    else if (name === "skip" && typeof value === "number") command.skip = value;
    else if (name === "sort") command.sort = asDocument(value, "sort()");
    else if (name === "projection" || name === "project") {
      command.projection = asDocument(value, "projection()");
    }
  }

  return command;
}

/** Map `find(filter, projection)` / `updateOne(filter, update)` etc. onto named fields. */
function applyPositionalArgs(command: MongoCommand, args: unknown[]): void {
  const op = command.operation;

  if (op === "aggregate") {
    const pipeline = args[0];
    if (!Array.isArray(pipeline)) throw new MongoCommandError("aggregate() needs a pipeline array.");
    command.pipeline = pipeline as Record<string, unknown>[];
    return;
  }

  if (op === "distinct") {
    if (typeof args[0] !== "string") throw new MongoCommandError("distinct() needs a field name.");
    command.field = args[0];
    if (args[1] !== undefined) command.filter = asDocument(args[1], "distinct() filter");
    return;
  }

  if (op === "insertOne" || op === "insertMany") {
    const docs = op === "insertOne" ? [args[0]] : args[0];
    if (!Array.isArray(docs)) throw new MongoCommandError("insertMany() needs an array.");
    command.documents = docs.map((d) => asDocument(d, "Inserted document"));
    return;
  }

  if (op === "createIndex") {
    command.index = asDocument(args[0], "createIndex() specification");
    return;
  }

  if (op === "dropIndex") {
    if (typeof args[0] !== "string") throw new MongoCommandError("dropIndex() needs an index name.");
    command.index = args[0];
    return;
  }

  if (op === "updateOne" || op === "updateMany" || op === "replaceOne") {
    command.filter = asDocument(args[0] ?? {}, "Update filter");
    command.update = asDocument(args[1], "Update document");
    return;
  }

  // find / findOne / countDocuments / deleteOne / deleteMany / drop / list*
  if (args[0] !== undefined) command.filter = asDocument(args[0], "Filter");
  if ((op === "find" || op === "findOne") && args[1] !== undefined) {
    command.projection = asDocument(args[1], "Projection");
  }
}

/**
 * Does this pipeline write?
 *
 * `$out` and `$merge` replace or upsert into a collection, so an `aggregate`
 * containing either is a write no matter how it reads. They can appear in a
 * `$facet` or `$unionWith` sub-pipeline too, hence the recursive walk.
 */
export function pipelineWritesOutput(pipeline: unknown): string | null {
  if (Array.isArray(pipeline)) {
    for (const stage of pipeline) {
      const found = pipelineWritesOutput(stage);
      if (found) return found;
    }
    return null;
  }
  if (!pipeline || typeof pipeline !== "object") return null;
  for (const [key, value] of Object.entries(pipeline)) {
    if (key === "$out" || key === "$merge") return key;
    const found = pipelineWritesOutput(value);
    if (found) return found;
  }
  return null;
}

/**
 * Classify a parsed command, accounting for pipelines that write.
 *
 * Separate from {@link mongoCommandKind} because the operation alone is not
 * enough: `aggregate` is a read right up until the pipeline ends in `$out`.
 */
export function classifyMongoCommand(command: MongoCommand): {
  kind: MongoCommandKind;
  reason?: string;
} {
  const base = mongoCommandKind(command.operation);
  if (base === "read" && command.operation === "aggregate") {
    const stage = pipelineWritesOutput(command.pipeline);
    if (stage) return { kind: "write", reason: `The pipeline contains ${stage}, which writes a collection.` };
  }
  return { kind: base };
}
