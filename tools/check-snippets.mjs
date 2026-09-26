// Lints every TypeScript snippet a plugin ships against the conventions the plugin teaches.
//
// Snippets are fragments on purpose: they use illustrative entities and dependencies they never
// declare, so they are not compiled. Only the rules that need no type information run here, and an
// undeclared identifier is not an error. Each fenced ```typescript block in a skill's or an agent's
// Markdown is wrapped as little as it needs to parse — as written, then as a class body (a lone
// method or property), a function body (loose statements), the members of an object literal, an
// expression, and decorators over a method — and the first wrapping that parses is linted. The `.ts`
// files under a skill's `examples/` are linted as written.
//
// A block that must break a convention to make its point is excluded by writing
// `<!-- snippet-check: skip -->` on the line before its opening fence (see CLAUDE.md).
//
// Usage: node tools/check-snippets.mjs [path ...]   (defaults to every plugin)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import stylistic from "@stylistic/eslint-plugin";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const SKIP_MARKER = "<!-- snippet-check: skip -->";
const OPENING_FENCE = /^(\s*)```typescript\s*$/;
const CLOSING_FENCE = /^\s*```\s*$/;

// Each wrapping adds exactly one line above the snippet, so a reported line maps back by subtracting
// `offset`.
const WRAPPINGS = [
  { name: "module", offset: 0, wrap: (code) => code },
  { name: "class body", offset: 1, wrap: (code) => `class Snippet {\n${code}\n}\n` },
  {
    name: "function body",
    offset: 1,
    wrap: (code) => `async function snippet(): Promise<void> {\n${code}\n}\n`,
  },
  { name: "object members", offset: 1, wrap: (code) => `const snippet = {\n${code}\n};\n` },
  { name: "expression", offset: 1, wrap: (code) => `const snippet = (\n${code}\n);\n` },
  {
    name: "decorators",
    offset: 1,
    wrap: (code) => `class Snippet {\n${code}\npublic decorated(): void {}\n}\n`,
  },
];

// The template's rules that hold without the whole program. Keep the options identical to the
// template's eslint.config.mjs, so a snippet and the code it models are judged the same way.
const CONFIG = [
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        // The template compiles with both, and consistent-type-imports reads them to leave alone the
        // imports that decorator metadata needs at runtime.
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
      },
    },
    plugins: { "@typescript-eslint": tseslint.plugin, "@stylistic": stylistic },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          allowExpressions: false,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
        },
      ],
      "@typescript-eslint/explicit-member-accessibility": ["error", { accessibility: "explicit" }],
      curly: ["error", "all"],
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: ["multiline-const", "multiline-let", "multiline-expression", "multiline-block-like", "multiline-return", "multiline-export", "multiline-type"], next: "*" },
        { blankLine: "always", prev: "*", next: ["multiline-const", "multiline-let", "multiline-expression", "multiline-block-like", "multiline-return", "multiline-export", "multiline-type"] },
      ],
      "no-console": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      // import-x/consistent-type-specifier-style ("prefer-top-level") and the ban on `enum`, as
      // selectors, so the check needs no plugin beyond typescript-eslint.
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportSpecifier[importKind='type'], ExportSpecifier[exportKind='type']",
          message: "Write a top-level `import type` / `export type`, not an inline `type` specifier.",
        },
        {
          selector: "TSEnumDeclaration",
          message: "Derive the union from an `as const` array instead of declaring an `enum`.",
        },
      ],
    },
  },
];

const linter = new Linter({ configType: "flat" });

function lint(code) {
  return linter.verify(code, CONFIG, { filename: "snippet.ts" });
}

function filesUnder(path) {
  if (statSync(path).isFile()) {
    return [path];
  }

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "results" || entry.name.startsWith(".")) {
      return [];
    }

    return filesUnder(join(path, entry.name));
  });
}

function isExample(path) {
  return path.endsWith(".ts") && path.split(/[\\/]/).includes("examples");
}

// What reaches a session: skills, with their references, and agents. An eval case's prompt may plant
// violations on purpose, so evals/ is not checked.
function isShippedMarkdown(path) {
  const segments = path.split(/[\\/]/);

  return path.endsWith(".md") && (segments.includes("skills") || segments.includes("agents"));
}

// Returns each ```typescript block with the file line its first code line sits on and its 1-based
// position among the file's TypeScript blocks, skipped ones included, so the number matches what a
// reader counts.
function blocksOf(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const opening = OPENING_FENCE.exec(lines[index]);

    if (!opening) {
      index += 1;
      continue;
    }

    const indent = opening[1].length;
    const firstLine = index + 2;
    const body = [];
    let previous = index - 1;

    while (previous >= 0 && lines[previous].trim() === "") {
      previous -= 1;
    }

    index += 1;

    while (index < lines.length && !CLOSING_FENCE.test(lines[index])) {
      body.push(lines[index].slice(Math.min(indent, lines[index].search(/\S|$/))));
      index += 1;
    }

    blocks.push({
      number: blocks.length + 1,
      firstLine,
      code: body.join("\n"),
      skipped: previous >= 0 && lines[previous].trim() === SKIP_MARKER,
    });
    index += 1;
  }

  return blocks;
}

function checkBlock(block) {
  let firstFailure = null;

  for (const wrapping of WRAPPINGS) {
    const messages = lint(wrapping.wrap(block.code));
    const fatal = messages.find((message) => message.fatal);

    if (fatal) {
      firstFailure ??= fatal;
      continue;
    }

    return messages.map((message) => ({ ...message, line: message.line - wrapping.offset }));
  }

  return [
    {
      ...firstFailure,
      ruleId: "parse",
      message: `parses under no wrapping (${WRAPPINGS.map((wrapping) => wrapping.name).join(", ")}): ` +
        firstFailure.message,
    },
  ];
}

const targets = process.argv.length > 2
  ? process.argv.slice(2).map((path) => resolve(path))
  : [join(REPOSITORY_ROOT, "plugins")];
const files = targets.flatMap(filesUnder);
const problems = [];
let checkedBlocks = 0;
let skippedBlocks = 0;
let checkedExamples = 0;

for (const file of files) {
  const shown = relative(REPOSITORY_ROOT, file).replaceAll("\\", "/");

  if (isShippedMarkdown(file)) {
    for (const block of blocksOf(readFileSync(file, "utf8"))) {
      if (block.skipped) {
        skippedBlocks += 1;
        continue;
      }

      checkedBlocks += 1;

      for (const message of checkBlock(block)) {
        const fileLine = block.firstLine + message.line - 1;

        problems.push(
          `${shown}: block ${block.number}, line ${message.line} (file line ${fileLine}): ` +
            `${message.message} [${message.ruleId}]`,
        );
      }
    }
  } else if (isExample(file)) {
    checkedExamples += 1;

    for (const message of lint(readFileSync(file, "utf8"))) {
      problems.push(`${shown}:${message.line}:${message.column}: ${message.message} [${message.ruleId ?? "parse"}]`);
    }
  }
}

for (const problem of problems) {
  console.error(problem);
}

console.log(
  `${checkedBlocks} snippets and ${checkedExamples} example files checked, ` +
    `${skippedBlocks} snippets skipped by marker: ${problems.length} problems.`,
);
process.exitCode = problems.length > 0 ? 1 : 0;
