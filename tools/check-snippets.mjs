// Lints every TypeScript snippet a plugin ships against the conventions the plugin teaches.
//
// Snippets are fragments on purpose: they use illustrative entities and dependencies they never
// declare, so they are not compiled. Only the rules that need no type information run here, and an
// undeclared identifier is not an error. Each fenced ```typescript or ```tsx block in a skill's or an
// agent's Markdown is wrapped as little as it needs to parse — as written, then as a class body (a
// lone method or property), a function body (loose statements), the members of an object literal, an
// expression, and decorators over a method — and the first wrapping that parses is linted. The
// `.ts` and `.tsx` files under a skill's `examples/` are linted as written.
//
// Each plugin is judged by its own reference project's rules: a backend snippet by the backend
// template's, a frontend one by the frontend template's. A plugin with snippets and no entry in
// CONFIGS is reported, rather than checked against another stack's rules.
//
// A block that must break a convention to make its point is excluded by writing
// `<!-- snippet-check: skip -->` on the line before its opening fence (see CLAUDE.md).
//
// Usage: node tools/check-snippets.mjs [path ...]   (defaults to every plugin)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import stylistic from "@stylistic/eslint-plugin";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";

// The frontend's own rule, shipped as an asset of the skill that owns the lint config: the snippets
// are checked against the very file a project copies.
import { paddingAroundHooks } from "../plugins/frontend-architecture/skills/project-bootstrap/assets/eslint-rules/padding-around-hooks.mjs";

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const PLUGINS_ROOT = join(REPOSITORY_ROOT, "plugins");
const SKIP_MARKER = "<!-- snippet-check: skip -->";
const OPENING_FENCE = /^(\s*)```(typescript|tsx)\s*$/;
const CLOSING_FENCE = /^\s*```\s*$/;
const EXAMPLE_EXTENSION = /\.tsx?$/;
// A hook call at the left margin: the block is a fragment of a component's body, which also parses
// as a module — where no hook can be called, and no rule about hook calls looks.
const TOP_LEVEL_HOOK_CALL = /^(?:(?:const|let) [^=]+= )?(?:\w+\.)?use[A-Z0-9]\w*\(/m;

// Each wrapping adds exactly one line above the snippet, so a reported line maps back by subtracting
// `offset`. Loose statements are wrapped in a function named like a hook, so the rules that apply
// only inside a component or a hook see them: a fragment of a component body is what such a block
// almost always is, and a fragment that calls no hook is left alone by those rules anyway.
const WRAPPINGS = [
  { name: "module", offset: 0, wrap: (code) => code },
  { name: "class body", offset: 1, wrap: (code) => `class Snippet {\n${code}\n}\n` },
  {
    name: "function body",
    offset: 1,
    wrap: (code) => `async function useSnippet(): Promise<void> {\n${code}\n}\n`,
  },
  { name: "object members", offset: 1, wrap: (code) => `const snippet = {\n${code}\n};\n` },
  { name: "expression", offset: 1, wrap: (code) => `const snippet = (\n${code}\n);\n` },
  {
    name: "decorators",
    offset: 1,
    wrap: (code) => `class Snippet {\n${code}\npublic decorated(): void {}\n}\n`,
  },
];

// A snippet may show a rule suspended on its line, and most of the project's rules need type
// information this check does not run: the directive is not unused in the project, only here.
const LINTER_OPTIONS = { reportUnusedDisableDirectives: "off" };

const MULTILINE_STATEMENTS = [
  "multiline-const",
  "multiline-let",
  "multiline-expression",
  "multiline-block-like",
  "multiline-return",
  "multiline-export",
  "multiline-type",
];

// The rules both templates share, with the options both give them.
const SHARED_RULES = {
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
  "@stylistic/no-multiple-empty-lines": ["error", { max: 1, maxBOF: 0, maxEOF: 0 }],
  "@stylistic/padding-line-between-statements": [
    "error",
    { blankLine: "always", prev: MULTILINE_STATEMENTS, next: "*" },
    { blankLine: "always", prev: "*", next: MULTILINE_STATEMENTS },
  ],
  "no-console": "error",
  "@typescript-eslint/consistent-type-imports": [
    "error",
    { prefer: "type-imports", fixStyle: "separate-type-imports" },
  ],
};

// import-x/consistent-type-specifier-style ("prefer-top-level") and the ban on `enum`, as selectors,
// so the check needs no plugin beyond typescript-eslint.
const SHARED_RESTRICTED_SYNTAX = [
  {
    selector: "ImportSpecifier[importKind='type'], ExportSpecifier[exportKind='type']",
    message: "Write a top-level `import type` / `export type`, not an inline `type` specifier.",
  },
  {
    selector: "TSEnumDeclaration",
    message: "Derive the union from an `as const` array instead of declaring an `enum`.",
  },
];

// The backend template's rules that hold without the whole program. Keep the options identical to
// its eslint.config.mjs, so a snippet and the code it models are judged the same way.
const BACKEND_CONFIG = [
  {
    files: ["**/*.ts", "**/*.tsx"],
    linterOptions: LINTER_OPTIONS,
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
      ...SHARED_RULES,
      "no-restricted-syntax": ["error", ...SHARED_RESTRICTED_SYNTAX],
    },
  },
];

// The frontend template's, on the same terms: the shared core, the JSX spacing rule, its own rule for
// the hook calls that open a component, and the ban on a second headless UI library.
const FRONTEND_CONFIG = [
  {
    files: ["**/*.ts", "**/*.tsx"],
    linterOptions: LINTER_OPTIONS,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "@stylistic": stylistic,
      local: { rules: { "padding-around-hooks": paddingAroundHooks } },
    },
    rules: {
      ...SHARED_RULES,
      "no-restricted-syntax": ["error", ...SHARED_RESTRICTED_SYNTAX],
      "local/padding-around-hooks": "error",
      "@stylistic/jsx-newline": ["error", { prevent: true, allowMultilines: true }],
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "radix-ui", message: "The UI primitives are Base UI (@base-ui/react)." }],
          patterns: [{ group: ["@radix-ui/*"], message: "The UI primitives are Base UI (@base-ui/react)." }],
        },
      ],
    },
  },
];

const CONFIGS = {
  "backend-architecture": BACKEND_CONFIG,
  "frontend-architecture": FRONTEND_CONFIG,
};

const linter = new Linter({ configType: "flat" });

function pluginOf(path) {
  const [name] = relative(PLUGINS_ROOT, path).split(sep);

  return name;
}

function lint(code, config, extension) {
  return linter.verify(code, config, { filename: `snippet.${extension}` });
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
  return EXAMPLE_EXTENSION.test(path) && path.split(/[\\/]/).includes("examples");
}

// What reaches a session: skills, with their references, and agents. An eval case's prompt may plant
// violations on purpose, so evals/ is not checked.
function isShippedMarkdown(path) {
  const segments = path.split(/[\\/]/);

  return path.endsWith(".md") && (segments.includes("skills") || segments.includes("agents"));
}

// Returns each ```typescript or ```tsx block with the file line its first code line sits on, the
// extension it is linted as, and its 1-based position among the file's code blocks, skipped ones
// included, so the number matches what a reader counts.
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
    const extension = opening[2] === "tsx" ? "tsx" : "ts";
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
      extension,
      code: body.join("\n"),
      skipped: previous >= 0 && lines[previous].trim() === SKIP_MARKER,
    });
    index += 1;
  }

  return blocks;
}

function wrappingsFor(code) {
  if (!TOP_LEVEL_HOOK_CALL.test(code)) {
    return WRAPPINGS;
  }

  const functionBody = WRAPPINGS.find((wrapping) => wrapping.name === "function body");

  return [functionBody, ...WRAPPINGS.filter((wrapping) => wrapping !== functionBody)];
}

function checkBlock(block, config) {
  let firstFailure = null;

  for (const wrapping of wrappingsFor(block.code)) {
    const messages = lint(wrapping.wrap(block.code), config, block.extension);
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
  : [PLUGINS_ROOT];
const files = targets.flatMap(filesUnder);
const problems = [];
let checkedBlocks = 0;
let skippedBlocks = 0;
let checkedExamples = 0;

for (const file of files) {
  const shown = relative(REPOSITORY_ROOT, file).replaceAll("\\", "/");
  const plugin = pluginOf(file);
  const config = CONFIGS[plugin];

  if (isShippedMarkdown(file)) {
    for (const block of blocksOf(readFileSync(file, "utf8"))) {
      if (block.skipped) {
        skippedBlocks += 1;
        continue;
      }

      if (config === undefined) {
        problems.push(`${shown}: block ${block.number}: the plugin "${plugin}" has no snippet config in tools/check-snippets.mjs`);
        continue;
      }

      checkedBlocks += 1;

      for (const message of checkBlock(block, config)) {
        const fileLine = block.firstLine + message.line - 1;

        problems.push(
          `${shown}: block ${block.number}, line ${message.line} (file line ${fileLine}): ` +
            `${message.message} [${message.ruleId}]`,
        );
      }
    }
  } else if (isExample(file)) {
    if (config === undefined) {
      problems.push(`${shown}: the plugin "${plugin}" has no snippet config in tools/check-snippets.mjs`);
      continue;
    }

    checkedExamples += 1;

    for (const message of lint(readFileSync(file, "utf8"), config, file.endsWith(".tsx") ? "tsx" : "ts")) {
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
