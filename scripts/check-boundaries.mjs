import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const uiRoot = path.join(root, "apps/ui");
const coreRoot = path.join(root, "apps/core");
const uiLib = path.join(uiRoot, "lib");
const require = createRequire(path.join(uiRoot, "package.json"));
const ts = require("typescript");
const extensions = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const excludedDirs = new Set(["node_modules", "dist", "coverage", "playwright-report", "test-results"]);
const errors = [];

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name.startsWith(".") || excludedDirs.has(entry.name) ? [] : filesIn(file);
    }
    return entry.isFile() && extensions.test(entry.name) ? [file] : [];
  });
}

function inside(file, directory) {
  return file === directory || file.startsWith(`${directory}${path.sep}`);
}

function isTest(file) {
  return /(?:^|[./\\])(?:__tests__|[^/\\]+\.(?:test|spec))(?=[./\\])/.test(file);
}

function importIsTypeOnly(node) {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  return !clause.name && bindings && ts.isNamedImports(bindings)
    && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
}

function exportIsTypeOnly(node) {
  return node.isTypeOnly || Boolean(node.exportClause && ts.isNamedExports(node.exportClause)
    && node.exportClause.elements.length > 0 && node.exportClause.elements.every((element) => element.isTypeOnly));
}

function checkImport(file, source, node, specifier, typeOnly) {
  const inCore = inside(file, coreRoot);
  const inUi = inside(file, uiRoot);
  const resolved = specifier.startsWith(".") || path.isAbsolute(specifier)
    ? path.resolve(path.dirname(file), specifier)
    : null;
  let violation;
  if (inCore && (specifier === "@devhub/ui" || specifier.startsWith("@devhub/ui/")
      || specifier === "dashboard" || specifier.startsWith("dashboard/")
      || specifier.startsWith("@/") || (resolved && inside(resolved, uiRoot)))) {
    violation = "core must not import UI";
  } else if (inUi && !typeOnly && (specifier === "@devhub/core" || specifier.startsWith("@devhub/core/")
      || (resolved && inside(resolved, coreRoot)))) {
    violation = "UI must not import core at runtime";
  } else if (inside(file, uiLib) && !isTest(file) && specifier.startsWith("node:")) {
    violation = "UI lib must not import Node modules";
  }
  if (violation) {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    errors.push(`${path.relative(root, file)}:${line + 1}:${character + 1}: ${violation}: ${specifier}`);
  }
}

function checkFile(file) {
  const kind = /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind);
  const literal = (node) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
  function visit(node) {
    if (ts.isImportDeclaration(node) && literal(node.moduleSpecifier)) {
      checkImport(file, source, node, node.moduleSpecifier.text, importIsTypeOnly(node));
    } else if (ts.isExportDeclaration(node) && literal(node.moduleSpecifier)) {
      checkImport(file, source, node, node.moduleSpecifier.text, exportIsTypeOnly(node));
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
        && literal(node.moduleReference.expression)) {
      checkImport(file, source, node, node.moduleReference.expression.text, node.isTypeOnly);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
        && literal(node.argument.literal)) {
      checkImport(file, source, node, node.argument.literal.text, true);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require")
        || (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
          && node.expression.expression.text === "require" && node.expression.name.text === "resolve"))
        && node.arguments.length >= 1 && literal(node.arguments[0])) {
      checkImport(file, source, node, node.arguments[0].text, false);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

for (const file of [...filesIn(coreRoot), ...filesIn(uiRoot)]) checkFile(file);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}
