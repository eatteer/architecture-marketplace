// Finds a type annotation on a function-local `const`/`let` that the compiler would infer anyway —
// the declared type itself, or the literal of it — and reports it. Every candidate is verified by
// recompiling with the annotations removed: one whose inferred type differs, or whose file gains a
// diagnostic, is dropped, and a file where every edit failed is retried one edit at a time.
// Module-level constants are left alone.
//
// Run from the project root, which must hold its tsconfig.json and have `typescript` installed:
//   node <this file>            reports what it would remove, and writes nothing
//   node <this file> --write    removes the annotations
// Afterwards run the project's linter and its typecheck.

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
const files = parsed.fileNames.filter((file) => !file.includes("node_modules"));

function isLocal(declaration) {
  const list = declaration.parent;
  const statement = list && list.parent;

  if (!statement || !ts.isVariableStatement(statement)) {
    return false;
  }

  let current = statement.parent;

  while (current && !ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current)) {
      return true;
    }

    current = current.parent;
  }

  return false;
}

// An initializer whose type depends on the annotation around it: without it, a callback loses its
// parameter types, a literal widens differently, `null` and `undefined` become their own types.
function isContextSensitive(node) {
  let found = false;

  const visit = (child) => {
    if (found) {
      return;
    }

    if (
      ts.isArrowFunction(child) ||
      ts.isFunctionExpression(child) ||
      ts.isObjectLiteralExpression(child) ||
      ts.isArrayLiteralExpression(child) ||
      child.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isIdentifier(child) && child.text === "undefined")
    ) {
      found = true;

      return;
    }

    ts.forEachChild(child, visit);
  };

  visit(node);

  return found;
}

function candidates(program) {
  const checker = program.getTypeChecker();
  const result = new Map();

  for (const file of files) {
    const sourceFile = program.getSourceFile(file);

    if (!sourceFile) {
      continue;
    }

    const edits = [];

    const visit = (node) => {
      const isCandidate =
        ts.isVariableDeclaration(node) &&
        node.type &&
        node.initializer &&
        ts.isIdentifier(node.name) &&
        isLocal(node) &&
        !isContextSensitive(node.initializer);

      if (isCandidate) {
        edits.push({
          name: node.name.text,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          start: node.name.getEnd(),
          end: node.type.getEnd(),
          declared: checker.typeToString(checker.getTypeFromTypeNode(node.type), undefined, ts.TypeFormatFlags.NoTruncation),
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    if (edits.length > 0) {
      result.set(file, edits);
    }
  }

  return result;
}

function apply(text, edits) {
  let output = text;

  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + output.slice(edit.end);
  }

  return output;
}

function compileWith(overrides) {
  const host = ts.createCompilerHost(parsed.options);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);

  host.readFile = (file) => overrides.get(path.resolve(file)) ?? readFile(file);
  host.getSourceFile = (file, languageVersion, onError, shouldCreate) => {
    const text = overrides.get(path.resolve(file));

    if (text === undefined) {
      return getSourceFile(file, languageVersion, onError, shouldCreate);
    }

    return ts.createSourceFile(file, text, languageVersion, true);
  };

  return ts.createProgram(files, parsed.options, host);
}

function findToken(node, position) {
  if (position < node.getStart() || position >= node.getEnd()) {
    return undefined;
  }

  let found = node;

  ts.forEachChild(node, (child) => {
    const inner = findToken(child, position);

    if (inner) {
      found = inner;
    }
  });

  return found;
}

// Where each edited declaration sits after the edits: the edits only remove text, so a declaration
// moves left by the length of everything removed before it in the same file.
function inferredAfter(program, file, edits, kept) {
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(file);
  const answers = new Map();
  let removed = 0;

  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    if (!kept.has(edit)) {
      continue;
    }

    const token = findToken(sourceFile, edit.start - removed - 1);
    const declaration = token && token.parent;

    if (declaration && ts.isVariableDeclaration(declaration)) {
      const type = checker.getTypeAtLocation(declaration.name);
      const exact = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
      const widened = checker.typeToString(checker.getBaseTypeOfLiteralType(type), undefined, ts.TypeFormatFlags.NoTruncation);

      // A `const` bound to a literal infers the literal, which is narrower than the annotation and
      // just as correct: the annotation adds nothing a reader needs.
      answers.set(edit, exact === edit.declared || widened === edit.declared ? edit.declared : exact);
    }

    removed += edit.end - edit.start;
  }

  return answers;
}

function diagnosticsOf(program, file) {
  return ts.getPreEmitDiagnostics(program, program.getSourceFile(file)).length;
}

const original = ts.createProgram(files, parsed.options);
const baseline = new Map(files.map((file) => [file, diagnosticsOf(original, file)]));
const all = candidates(original);
const overrides = new Map();
const kept = new Set();

function override(file, edits) {
  overrides.set(path.resolve(file), apply(fs.readFileSync(file, "utf8"), edits));
}

for (const [file, edits] of all) {
  edits.forEach((edit) => kept.add(edit));
  override(file, edits);
}

for (let round = 0; round < 6; round += 1) {
  const program = compileWith(overrides);
  let dropped = 0;

  for (const [file, edits] of all) {
    const active = edits.filter((edit) => kept.has(edit));

    if (active.length === 0) {
      continue;
    }

    const answers = inferredAfter(program, file, edits, kept);
    const mismatched = active.filter((edit) => answers.get(edit) !== edit.declared);

    // A mismatch goes first; only a file whose every remaining edit matches and that still gained a
    // diagnostic loses the rest, so one bad edit does not take its innocent neighbours with it.
    let toDrop = mismatched;

    if (toDrop.length === 0 && diagnosticsOf(program, file) > baseline.get(file)) {
      toDrop = active;
    }

    for (const edit of toDrop) {
      kept.delete(edit);
      dropped += 1;
    }

    override(file, edits.filter((edit) => kept.has(edit)));
  }

  if (dropped === 0) {
    break;
  }
}

// A file that lost every edit: try them one at a time, keeping each that neither changes its type
// nor adds a diagnostic on top of the ones already kept.
for (const [file, edits] of all) {
  if (edits.some((edit) => kept.has(edit))) {
    continue;
  }

  const accepted = new Set();

  for (const edit of edits) {
    accepted.add(edit);
    override(file, edits.filter((candidate) => accepted.has(candidate)));

    const program = compileWith(overrides);
    const answers = inferredAfter(program, file, edits, accepted);

    if (diagnosticsOf(program, file) > baseline.get(file) || answers.get(edit) !== edit.declared) {
      accepted.delete(edit);
    }
  }

  for (const edit of accepted) {
    kept.add(edit);
  }

  override(file, edits.filter((edit) => kept.has(edit)));
}

let total = 0;

for (const [file, edits] of all) {
  const active = edits.filter((edit) => kept.has(edit));

  if (active.length === 0) {
    continue;
  }

  total += active.length;

  for (const edit of active) {
    console.log(`${path.relative(root, file)}:${edit.line}: ${edit.name}: ${edit.declared}`);
  }

  if (write) {
    fs.writeFileSync(file, apply(fs.readFileSync(file, "utf8"), active));
  }
}

const candidateCount = [...all.values()].reduce((sum, edits) => sum + edits.length, 0);

console.log(
  `${candidateCount} annotated locals, ${total} ${write ? "removed" : "removable (run with --write)"}, ` +
    `${candidateCount - total} kept because they inform`,
);
