// Finds value imports whose every use is a type position outside a decorated signature, and reports
// the separate `import type` statement each one becomes. This is the linter's blind spot: its
// type-import rule skips every file with decorators, because decorator metadata reads the types of a
// decorated constructor, parameter or property at runtime — those stay value imports here too.
//
// Run from the project root, which must hold its tsconfig.json and have `typescript` installed:
//   node <this file>            reports what it would change, and writes nothing
//   node <this file> --write    rewrites the imports
// Afterwards run the project's linter (the import order may need its --fix) and its typecheck.

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const ts = loadTypeScript();
const write = process.argv.includes("--write");

function loadTypeScript() {
  try {
    return require(require.resolve("typescript", { paths: [root] }));
  } catch {
    console.error(`No 'typescript' package resolves from ${root}. Run this from the project root.`);
    process.exit(1);
  }
}

const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile).config;
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

function hasDecorators(node) {
  return ts.canHaveDecorators(node) && (ts.getDecorators(node) || []).length > 0;
}

// True when the node sits in a type annotation the decorator metadata emits at runtime.
function inDecoratedSignature(node) {
  let current = node;

  while (current && !ts.isSourceFile(current)) {
    const parent = current.parent;

    if (parent && ts.isParameter(parent) && parent.type === current) {
      const owner = parent.parent;

      if (ts.isConstructorDeclaration(owner) && owner.parent && hasDecorators(owner.parent)) {
        return true;
      }

      if (ts.isMethodDeclaration(owner) && (hasDecorators(owner) || owner.parameters.some(hasDecorators))) {
        return true;
      }

      return hasDecorators(parent);
    }

    const isMember =
      parent &&
      (ts.isPropertyDeclaration(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isGetAccessor(parent) ||
        ts.isSetAccessor(parent));

    if (isMember && parent.type === current) {
      return hasDecorators(parent);
    }

    current = parent;
  }

  return false;
}

function isTypePosition(identifier) {
  let current = identifier;

  while (current.parent) {
    const parent = current.parent;

    // `typeof X` reads the value.
    if (ts.isTypeQueryNode(parent)) {
      return false;
    }

    // `implements X` is a type; `extends X` on a class is a value.
    if (ts.isExpressionWithTypeArguments(parent) && parent.expression === current) {
      const clause = parent.parent;

      return ts.isHeritageClause(clause) && clause.token === ts.SyntaxKind.ImplementsKeyword;
    }

    if (ts.isTypeNode(parent) || ts.isTypeReferenceNode(parent)) {
      return true;
    }

    if (!ts.isQualifiedName(parent)) {
      return false;
    }

    current = parent;
  }

  return false;
}

function isOnlyUsedAsType(element, statement, sourceFile) {
  const symbol = checker.getSymbolAtLocation(element.name);
  let allType = true;
  let used = false;

  const visit = (node) => {
    if (!allType) {
      return;
    }

    const isUse =
      ts.isIdentifier(node) &&
      node !== element.name &&
      node.text === element.name.text &&
      checker.getSymbolAtLocation(node) === symbol;

    if (isUse) {
      used = true;

      if (!isTypePosition(node) || inDecoratedSignature(node)) {
        allType = false;
      }
    }

    ts.forEachChild(node, visit);
  };

  for (const other of sourceFile.statements) {
    if (other !== statement) {
      visit(other);
    }
  }

  return used && allType;
}

const projectRoot = root.replace(/\\/g, "/");
const report = [];

for (const sourceFile of program.getSourceFiles()) {
  const file = sourceFile.fileName;

  if (file.includes("node_modules") || !file.startsWith(projectRoot)) {
    continue;
  }

  const edits = [];

  for (const statement of sourceFile.statements) {
    const clause = ts.isImportDeclaration(statement) ? statement.importClause : undefined;

    if (!clause || clause.isTypeOnly || clause.name) {
      continue;
    }

    const bindings = clause.namedBindings;

    if (!bindings || !ts.isNamedImports(bindings)) {
      continue;
    }

    const typeOnly = [];
    const keep = [];

    for (const element of bindings.elements) {
      if (element.isTypeOnly || isOnlyUsedAsType(element, statement, sourceFile)) {
        typeOnly.push(element);
      } else {
        keep.push(element);
      }
    }

    const converted = typeOnly.filter((element) => !element.isTypeOnly);

    if (converted.length === 0) {
      continue;
    }

    const specifier = statement.moduleSpecifier.getText(sourceFile);
    const nameOf = (element) => element.getText(sourceFile).replace(/^type\s+/, "");
    const typeLine = `import type { ${typeOnly.map(nameOf).join(", ")} } from ${specifier};`;
    const replacement =
      keep.length > 0 ? `import { ${keep.map(nameOf).join(", ")} } from ${specifier};\n${typeLine}` : typeLine;

    edits.push({ start: statement.getStart(sourceFile), end: statement.getEnd(), replacement });
    report.push(`${path.relative(root, file)}: ${converted.map((element) => element.name.text).join(", ")}`);
  }

  if (write && edits.length > 0) {
    let output = sourceFile.getFullText();

    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
    }

    fs.writeFileSync(file, output);
  }
}

for (const line of report) {
  console.log(line);
}

console.log(`${report.length} import statements ${write ? "rewritten" : "would be rewritten (run with --write)"}`);
