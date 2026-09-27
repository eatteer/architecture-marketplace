// Two one-line statements that do different kinds of work are two paragraphs (see the
// code-conventions skill): an assignment and a call, and a step that is awaited and one that is not.
// A declaration beside a bare statement is padding-line-between-statements' to separate, and a
// statement taller than a line already has a blank line on each side.

const MIN_LINES_FOR_A_BLANK = 2;

const KIND_NAMES = {
  assignment: "an assignment",
  awaited: "an awaited step",
  call: "a call",
};

function isSingleLine(node) {
  return node.loc.start.line === node.loc.end.line;
}

function kindOf(statement) {
  if (statement.type !== "ExpressionStatement" || !isSingleLine(statement)) {
    return undefined;
  }

  const { expression } = statement;

  if (expression.type === "AssignmentExpression" || expression.type === "UpdateExpression") {
    return "assignment";
  }

  return expression.type === "AwaitExpression" ? "awaited" : "call";
}

/** @type {import("eslint").Rule.RuleModule} */
export const paddingBetweenExpressionKinds = {
  meta: {
    type: "layout",
    fixable: "whitespace",
    docs: { description: "Require a blank line between one-line statements that do different kinds of work" },
    messages: {
      missingBlankLine: "{{previous}} and {{current}} are different kinds of work: leave a blank line between them.",
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context;

    // The last token or comment on the statement's final line, so a trailing comment stays with it.
    function lastOnLine(statement) {
      let last = sourceCode.getLastToken(statement);
      let next = sourceCode.getTokenAfter(last, { includeComments: true });

      while (next && next.loc.start.line === statement.loc.end.line) {
        last = next;
        next = sourceCode.getTokenAfter(last, { includeComments: true });
      }

      return { last, next };
    }

    function checkStatements(statements) {
      statements.slice(1).forEach((statement, index) => {
        const previous = statements[index];
        const previousKind = kindOf(previous);
        const kind = kindOf(statement);

        if (previousKind === undefined || kind === undefined || previousKind === kind) {
          return;
        }

        const { last, next } = lastOnLine(previous);

        if (next !== null && next.loc.start.line - last.loc.end.line >= MIN_LINES_FOR_A_BLANK) {
          return;
        }

        const previousName = KIND_NAMES[previousKind];

        context.report({
          node: statement,
          messageId: "missingBlankLine",
          data: {
            previous: previousName.charAt(0).toUpperCase() + previousName.slice(1),
            current: KIND_NAMES[kind],
          },
          fix: (fixer) => fixer.insertTextAfter(last, "\n"),
        });
      });
    }

    return {
      Program: (node) => checkStatements(node.body),
      BlockStatement: (node) => checkStatements(node.body),
      StaticBlock: (node) => checkStatements(node.body),
      SwitchCase: (node) => checkStatements(node.consequent),
    };
  },
};
