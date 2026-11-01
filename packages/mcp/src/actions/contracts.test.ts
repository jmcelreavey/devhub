import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { expect, it, vi } from "vitest";
import ts from "typescript";
import { execExternal } from "../../../../apps/core/src/lib/exec-external.ts";
import * as actions from "../../../../packages/shared/actions/index.ts";
import type { ActionAnnotations, HttpActionRoute } from "../../../../packages/shared/actions/define.ts";
import { TOOL_ANNOTATIONS } from "../annotations.ts";
import { createContext, type Context } from "../context.ts";
import { DashboardClient, type DashboardToolResult } from "../dashboard-client.ts";
import { coreToolNames } from "../server.ts";
import { registerStatusTools } from "../tools/status.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const toolsDir = path.join(root, "packages/mcp/src/tools");
const routesDir = path.join(root, "apps/core/src/http/routes");

const directRegistrations: Record<string, string> = {
  "events.ts:EVENT_WAIT_NAME": "Progress and cancellation are tied to the MCP request.",
};

const httpClassifications: Record<string, string> = {
  "GET /api/docs/[...path]": "The HTTP vault reads asynchronously; docs_read requires synchronous storage and returns an MCP-shaped result.",
  "GET /api/notes/[...path]": "The HTTP vault reads asynchronously; notes_read requires synchronous storage and returns an MCP-shaped result.",
  "PUT /api/docs/[...path]": "The HTTP writer enforces expectedModified and returns 428 for unversioned updates; docs_write does neither.",
  "PUT /api/notes/[...path]": "The HTTP writer merges stale task-note revisions and distinguishes 428 from 409; notes_write uses synchronous reads and different conflict handling.",
  "POST /api/docs/[...path]": "This method creates directories as well as files; docs_create only writes files using synchronous reads.",
  "POST /api/notes/[...path]": "This method creates directories as well as files; notes_create only writes files using synchronous reads.",
  "DELETE /api/docs/[...path]": "This method deletes directories and accepts expectedModified; docs_delete supports neither and uses synchronous reads.",
  "DELETE /api/notes/[...path]": "This method deletes directories and accepts expectedModified; notes_delete supports neither and uses synchronous reads.",
  "PATCH /api/docs/[...path]": "The shared vault factory renames files and directories with nullable revision checks; there is no corresponding docs rename action.",
  "PATCH /api/notes/[...path]": "The HTTP rename accepts nullable revisions and handles same-path moves; notes_rename requires synchronous file reads and a different revision contract.",
};

interface Contract {
  input: unknown;
  handler: unknown;
  http: HttpActionRoute | { reason: string };
  mcp: { name: string; toolset: string; annotations?: ActionAnnotations } | { reason: string };
}

function isContract(value: unknown): value is Contract {
  return value !== null && typeof value === "object" && "input" in value && "handler" in value;
}

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(file);
    return entry.isFile() && entry.name === "route.ts" ? [file] : [];
  });
}

it("classifies the exported actions and registers their MCP names", () => {
  const definitions = Object.entries(actions as Record<string, unknown>).filter((entry): entry is [string, Contract] => isContract(entry[1]));
  const names: string[] = [];
  const routes = new Map<string, Map<string | undefined, string>>();
  for (const [exportName, action] of definitions) {
    expect(action.http, `${exportName} HTTP`).toBeDefined();
    expect(action.mcp, `${exportName} MCP`).toBeDefined();
    if ("path" in action.http) {
      expect(action.http.method, exportName).toBeTruthy();
      expect(fs.existsSync(path.join(routesDir, action.http.path.replace(/^\/api\/?/, ""), "route.ts")), exportName).toBe(true);
      const route = `${action.http.method} ${action.http.path}`;
      const claims = routes.get(route) ?? new Map<string | undefined, string>();
      const discriminator = action.http.discriminator;
      if (discriminator !== undefined) {
        expect(discriminator.trim(), `${exportName} discriminator`).not.toBe("");
        expect(discriminator, `${exportName} discriminator`).toBe(discriminator.trim());
      }
      expect(claims.has(discriminator), `${route} (${discriminator ?? "whole route"}): ${claims.get(discriminator)} and ${exportName}`).toBe(false);
      claims.set(discriminator, exportName);
      routes.set(route, claims);
    } else {
      expect(action.http.reason.trim(), exportName).not.toBe("");
    }
    if ("name" in action.mcp) {
      expect(action.mcp.toolset, exportName).toBeTruthy();
      names.push(action.mcp.name);
      const hints = TOOL_ANNOTATIONS[action.mcp.name];
      const effectiveHints = action.mcp.annotations ?? hints;
      expect(effectiveHints, `${exportName} MCP annotations`).toBeDefined();
      for (const key of ["readOnlyHint", "destructiveHint", "idempotentHint"] as const) {
        expect(typeof effectiveHints?.[key], `${exportName} ${key}`).toBe("boolean");
      }
      if (action.mcp.annotations && hints) expect(action.mcp.annotations, `${exportName} MCP annotations`).toEqual(hints);
    } else {
      expect(action.mcp.reason.trim(), exportName).not.toBe("");
    }
  }
  for (const [route, claims] of routes) {
    if (claims.size > 1) expect(claims.has(undefined), `${route} has an undiscriminated claim`).toBe(false);
  }
  expect(new Set(names).size).toBe(names.length);
  const registeredNames = new Set(names);
  for (const name of Object.keys(TOOL_ANNOTATIONS)) {
    expect(registeredNames.has(name), `Stale MCP annotations: ${name}`).toBe(true);
  }
  expect([...coreToolNames(createContext())].sort()).toEqual([...names].sort());
});

function isActionImport(source: ts.SourceFile, specifier: string): boolean {
  const actionDir = path.join(root, "packages/shared/actions") + path.sep;
  return specifier.startsWith("@contracts/actions/") || path.resolve(path.dirname(source.fileName), specifier).startsWith(actionDir);
}

// Follow local helpers so a contract used by GET cannot classify a sibling POST.
// Only an action passed to the real HTTP adapter or invoked via .handler counts.
function actionCalls(source: ts.SourceFile, entry: ts.Node): Set<string> {
  const contracts = new Map<string, string>();
  const contractGroups = new Map<string, string[]>();
  const adapters = new Set<string>();
  const declarations = new Map<string, ts.Node[]>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    const actionImport = isActionImport(source, moduleName);
    const httpAdapterImport = moduleName === "@devhub/core/lib/actions/http" ||
      path.resolve(path.dirname(source.fileName), moduleName) === path.join(root, "apps/core/src/lib/actions/http");
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const item of bindings.elements) {
      if (item.isTypeOnly || statement.importClause?.isTypeOnly) continue;
      const imported = item.propertyName?.text ?? item.name.text;
      if (actionImport && isContract((actions as Record<string, unknown>)[imported])) {
        contracts.set(item.name.text, imported);
      }
      const group = (actions as Record<string, unknown>)[imported];
      if (actionImport && group && typeof group === "object" && !isContract(group)) {
        const entries = Object.values(group).map((value) => Object.entries(actions).find(([, action]) => action === value && isContract(action))?.[0]);
        if (entries.length && entries.every((name) => name !== undefined)) contractGroups.set(item.name.text, entries as string[]);
      }
      if (httpAdapterImport && imported === "httpAction") adapters.add(item.name.text);
    }
  }
  function index(node: ts.Node) {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
      const items = declarations.get(node.name.text) ?? [];
      items.push(node);
      declarations.set(node.name.text, items);
    }
    ts.forEachChild(node, index);
  }
  index(source);
  function visibleDeclarations(name: string, at: ts.Node): ts.Node[] {
    return (declarations.get(name) ?? []).filter((declaration) => {
      let scope = declaration.parent;
      while (scope && !ts.isBlock(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
      for (let parent: ts.Node | undefined = at; parent; parent = parent.parent) {
        if (parent === scope) return true;
      }
      return false;
    });
  }
  const calls = new Set<string>();
  type Bindings = Map<string, ts.Expression>;
  function resolve(node: ts.Node, bindings: Bindings, seen: Set<string>): void {
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)) {
      for (const name of contractGroups.get(node.expression.text) ?? []) calls.add(name);
      return;
    }
    if (ts.isIdentifier(node)) {
      const contract = contracts.get(node.text);
      if (contract) { calls.add(contract); return; }
      if (seen.has(node.text)) return;
      const next = new Set(seen).add(node.text);
      const bound = bindings.get(node.text);
      if (bound) { resolve(bound, bindings, next); return; }
      for (const declaration of visibleDeclarations(node.text, node)) {
        if (ts.isVariableDeclaration(declaration) && declaration.initializer) resolve(declaration.initializer, bindings, next);
      }
      return;
    }
    if (ts.isConditionalExpression(node)) {
      resolve(node.whenTrue, bindings, seen);
      resolve(node.whenFalse, bindings, seen);
    } else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
      resolve(node.expression, bindings, seen);
    }
  }
  function visit(node: ts.Node, bindings: Bindings, stack: Set<ts.Node>): void {
    if (ts.isConditionalExpression(node)) {
      for (const branch of [node.whenTrue, node.whenFalse]) {
        if (!ts.isIdentifier(branch)) continue;
        for (const declaration of visibleDeclarations(branch.text, branch)) {
          if (ts.isVariableDeclaration(declaration) && declaration.initializer && !stack.has(declaration)) {
            visit(declaration.initializer, bindings, new Set(stack).add(declaration));
          }
        }
      }
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && adapters.has(node.expression.text) && node.arguments[0]) {
        resolve(node.arguments[0], bindings, new Set());
      } else if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "handler") {
        resolve(node.expression.expression, bindings, new Set());
      } else if (ts.isIdentifier(node.expression)) {
        for (const declaration of visibleDeclarations(node.expression.text, node)) {
          const fn = ts.isFunctionDeclaration(declaration) ? declaration :
            ts.isVariableDeclaration(declaration) && declaration.initializer &&
            (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) ? declaration.initializer : undefined;
          if (!fn) {
            // Factory handlers such as putDoc are themselves adapter results.
            if (ts.isVariableDeclaration(declaration) && declaration.initializer && !stack.has(declaration)) {
              visit(declaration.initializer, bindings, new Set(stack).add(declaration));
            }
            continue;
          }
          if (!fn.body || stack.has(fn)) continue;
          const next = new Map(bindings);
          fn.parameters.forEach((parameter, index) => {
            if (ts.isIdentifier(parameter.name) && node.arguments[index]) next.set(parameter.name.text, node.arguments[index]);
          });
          visit(fn.body, next, new Set(stack).add(fn));
        }
      }
    }
    // Named helpers are examined only when called, not just because they are declared.
    if (ts.isFunctionDeclaration(node)) return;
    ts.forEachChild(node, (child) => visit(child, bindings, stack));
  }
  if (ts.isIdentifier(entry)) {
    for (const declaration of visibleDeclarations(entry.text, entry)) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) visit(declaration.initializer, new Map(), new Set());
      if (ts.isFunctionDeclaration(declaration) && declaration.body) visit(declaration.body, new Map(), new Set());
    }
  } else {
    visit(entry, new Map(), new Set());
  }
  return calls;
}

function checkContractImports(source: ts.SourceFile, relative: string): void {
  const definitions = actions as Record<string, unknown>;
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!isActionImport(source, statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const item of bindings.elements) {
      const imported = item.propertyName?.text ?? item.name.text;
      if (item.isTypeOnly || statement.importClause?.isTypeOnly || !isContract(definitions[imported])) continue;
      let used = false;
      function findUse(node: ts.Node) {
        if (ts.isImportDeclaration(node) || ts.isVoidExpression(node) || ts.isTypeNode(node)) return;
        if (ts.isIdentifier(node) && node.text === item.name.text) used = true;
        ts.forEachChild(node, findUse);
      }
      findUse(source);
      expect(used, `${relative}: imported action ${imported} is unused`).toBe(true);
    }
  }
}

it("classifies each tracked dashboard HTTP method and uses imported contracts", async () => {
  const { stdout } = await execExternal("git", ["ls-files", "-z", "--", "apps/core/src/http/routes"], { cwd: root });
  const tracked = new Set(stdout.split("\0"));
  const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
  const seenClassifications = new Set<string>();
  const definitions = actions as Record<string, unknown>;
  const factoryFile = path.join(root, "apps/core/src/lib/vault/create-vault-routes.ts");
  const factory = ts.createSourceFile(factoryFile, fs.readFileSync(factoryFile, "utf8"), ts.ScriptTarget.Latest, true);
  checkContractImports(factory, "apps/core/src/lib/vault/create-vault-routes.ts");

  for (const file of routeFiles(routesDir)) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (!tracked.has(relative)) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    checkContractImports(source, relative);
    const routePath = path.relative(routesDir, path.dirname(file)).split(path.sep).join("/");
    const route = routePath ? `/api/${routePath}` : "/api";
    const handlers = new Map<string, { source: ts.SourceFile; node: ts.Node }>();
    const vaultFactoryImported = source.statements.some((statement) => ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      (statement.moduleSpecifier.text === "@devhub/core/lib/vault/create-vault-routes" ||
        path.resolve(path.dirname(file), statement.moduleSpecifier.text) === path.join(root, "apps/core/src/lib/vault/create-vault-routes")) &&
      statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some((item) => !item.propertyName && item.name.text === "createVaultRoutes"));
    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement)) {
        expect(statement.exportClause, `${relative}: wildcard exports need HTTP classification`).toBeDefined();
        const names = statement.exportClause && ts.isNamedExports(statement.exportClause) ? statement.exportClause.elements.map((element) => element.name.text) : [];
        expect(names.filter((name) => methods.has(name)), `${relative}: HTTP re-exports need classification`).toEqual([]);
      }
      if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      if (ts.isFunctionDeclaration(statement) && statement.name && methods.has(statement.name.text)) {
        handlers.set(statement.name.text, { source, node: statement.body ?? statement });
      }
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && methods.has(declaration.name.text) && declaration.initializer) {
          handlers.set(declaration.name.text, { source, node: declaration.initializer });
        } else if (ts.isObjectBindingPattern(declaration.name) && declaration.name.elements.some((binding) => methods.has(binding.name.getText(source)))) {
          // The shared vault factory is inspected per returned method, not trusted by its import alone.
          expect(vaultFactoryImported, `${relative}: missing vault factory import`).toBe(true);
          expect(declaration.initializer?.getText(source), `${relative}: unrecognised handler factory`).toMatch(/^createVaultRoutes\(["'](?:docs|notes)["']\)$/);
          const vault = route.startsWith("/api/docs/") ? "docs" : "notes";
          expect(declaration.initializer?.getText(source), relative).toBe(`createVaultRoutes("${vault}")`);
          for (const binding of declaration.name.elements) {
            const name = binding.name.getText(source);
            if (!methods.has(name)) continue;
            let handler: ts.Node | undefined;
            let returned = false;
            function findHandler(node: ts.Node) {
              if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) handler = node.initializer;
              if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
                returned ||= node.expression.properties.some((property) => ts.isShorthandPropertyAssignment(property) && property.name.text === name);
              }
              ts.forEachChild(node, findHandler);
            }
            const factoryDeclaration = factory.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "createVaultRoutes");
            if (factoryDeclaration) findHandler(factoryDeclaration);
            expect(returned, `${relative}: ${name} not returned by vault factory`).toBe(true);
            expect(handler, `${relative}: ${name} missing from vault factory`).toBeDefined();
            if (handler) handlers.set(name, { source: factory, node: handler });
          }
        }
      }
    }
    for (const [method, handler] of handlers) {
      const key = `${method} ${route}`;
      const matched = [...actionCalls(handler.source, handler.node)].filter((name) => {
        const action = definitions[name];
        return isContract(action) && "path" in action.http && action.http.method === method && action.http.path === route;
      });
      if (httpClassifications[key]) {
        expect(httpClassifications[key].trim(), key).not.toBe("");
        expect(httpClassifications[key], key).not.toMatch(/^(?:TODO|FIXME):/);
        expect.soft(matched, `${key}: remove the stale classification`).toEqual([]);
        seenClassifications.add(key);
      } else {
        expect.soft(matched, `${key}: no action handler or HTTP adapter for this method`).not.toEqual([]);
      }
    }
  }
  expect([...seenClassifications].sort()).toEqual(Object.keys(httpClassifications).sort());
});

it("does not classify a sibling method or a metadata-only action import", () => {
  const source = ts.createSourceFile("fixture.ts", `
    import { agentUsage } from "@contracts/actions/agent-cli";
    import { httpAction } from "@devhub/core/lib/actions/http";
    export const GET = httpAction(agentUsage, {});
    export const POST = () => new Response();
  `, ts.ScriptTarget.Latest, true);
  const handlers = source.statements.flatMap((statement) => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []);
  expect([...actionCalls(source, handlers[0].initializer!)]).toEqual(["agentUsage"]);
  expect([...actionCalls(source, handlers[1].initializer!)]).toEqual([]);

  const conditional = ts.createSourceFile("conditional.ts", `
    import { agentUsage } from "@contracts/actions/agent-cli";
    import { httpAction } from "@devhub/core/lib/actions/http";
    const adapted = httpAction(agentUsage, {});
    export const GET = true ? adapted : () => new Response();
  `, ts.ScriptTarget.Latest, true);
  const handler = conditional.statements.find((statement) => ts.isVariableStatement(statement) && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
  if (!handler || !ts.isVariableStatement(handler)) throw new Error("Missing fixture handler");
  expect([...actionCalls(conditional, handler.declarationList.declarations[0].initializer!)]).toEqual(["agentUsage"]);

  const unused = ts.createSourceFile("unused.ts", `
    import { agentUsage } from "@contracts/actions/agent-cli";
    void agentUsage;
    export const GET = () => new Response();
  `, ts.ScriptTarget.Latest, true);
  expect(() => checkContractImports(unused, "unused.ts")).toThrow(/imported action agentUsage is unused/);
});

it("allows direct tool registrations only for the classified exceptions", () => {
  const direct: string[] = [];
  for (const file of fs.readdirSync(toolsDir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))) {
    const source = fs.readFileSync(path.join(toolsDir, file), "utf8");
    for (const match of source.matchAll(/\bserver\.registerTool\(\s*("[^"]+"|\w+)/g)) direct.push(`${file}:${match[1]}`);
  }
  expect(direct.sort()).toEqual(Object.keys(directRegistrations).sort());
  for (const reason of Object.values(directRegistrations)) expect(reason.trim()).not.toBe("");
});

it("reports the servers in the HTTP status envelope through MCP", async () => {
  const dashboard = new DashboardClient("http://localhost:1447");
  const get = vi.spyOn(dashboard, "get").mockResolvedValueOnce({
    servers: [{ name: "fixture", runningCount: 1, pids: [123], binaryExists: true }],
  });
  let run: (input: unknown) => Promise<DashboardToolResult> = async () => { throw new Error("Not registered"); };
  const server = {
    registerTool(name: string, _config: unknown, handler: typeof run) {
      if ("name" in actions.statusMcp.mcp && name === actions.statusMcp.mcp.name) run = handler;
    },
  };
  registerStatusTools(server as unknown as McpServer, { dashboard } as Context, ["status"], {});
  const result = await run({});
  expect(result.content[0]).toMatchObject({ text: expect.stringContaining("fixture: running ×1 (pids 123)") });
  expect(get).toHaveBeenCalledWith("/api/status/mcp");
});
