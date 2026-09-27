// A component or a hook opens by reading what it depends on through hooks, then works with it. Each
// thing it reads is a paragraph and the work another (see the code-conventions skill): a blank line
// sits between a hook call and a statement that calls none, and between two hook calls unless they
// read the same thing — the same hook (a run of `useId`, of `useState`) or the same object (a
// route's `useSearch` and `useNavigate`).

const HOOK_NAME = /^use[A-Z0-9]/;
// The names React itself treats as components and hooks, which are the only functions that call hooks.
const COMPONENT_OR_HOOK_NAME = /^(use[A-Z0-9]|[A-Z])/;
const MIN_LINES_FOR_A_BLANK = 2;
const REACT_NAMESPACE = "React";

function isHookCallee(callee) {
  if (callee.type === "Identifier") {
    return HOOK_NAME.test(callee.name);
  }

  return callee.type === "MemberExpression" && callee.property.type === "Identifier" && HOOK_NAME.test(callee.property.name);
}

function isHookCall(node) {
  return node?.type === "CallExpression" && isHookCallee(node.callee);
}

function hookCallOf(statement) {
  if (statement.type === "VariableDeclaration") {
    const init = statement.declarations.length === 1 ? statement.declarations[0].init : undefined;

    return isHookCall(init) ? init : undefined;
  }

  return statement.type === "ExpressionStatement" && isHookCall(statement.expression) ? statement.expression : undefined;
}

function functionName(node) {
  if (node.type === "FunctionDeclaration") {
    return node.id?.name;
  }

  return node.parent.type === "VariableDeclarator" && node.parent.id.type === "Identifier" ? node.parent.id.name : undefined;
}

/** @type {import("eslint").Rule.RuleModule} */
export const paddingAroundHooks = {
  meta: {
    type: "layout",
    fixable: "whitespace",
    docs: { description: "Require a blank line around each group of hook calls that read the same thing" },
    messages: {
      missingBlankLine: "Each thing a component reads through hooks is a paragraph of its own: leave a blank line here.",
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

    // What a hook call reads: the hook itself, or the object it is called on. `React.useState` is the
    // hook `useState` written through the namespace, not a read of `React`.
    function sourceOf(call) {
      const { callee } = call;

      if (callee.type !== "MemberExpression") {
        return callee.name;
      }

      return callee.object.type === "Identifier" && callee.object.name === REACT_NAMESPACE
        ? callee.property.name
        : sourceCode.getText(callee.object);
    }

    function belongTogether(previous, statement) {
      const previousCall = hookCallOf(previous);
      const call = hookCallOf(statement);

      if (previousCall === undefined || call === undefined) {
        return previousCall === call;
      }

      return sourceOf(previousCall) === sourceOf(call);
    }

    function checkBody(node) {
      if (node.body.type !== "BlockStatement" || !COMPONENT_OR_HOOK_NAME.test(functionName(node) ?? "")) {
        return;
      }

      const statements = node.body.body;

      statements.slice(1).forEach((statement, index) => {
        const previous = statements[index];

        if (belongTogether(previous, statement)) {
          return;
        }

        const { last, next } = lastOnLine(previous);

        if (next !== null && next.loc.start.line - last.loc.end.line >= MIN_LINES_FOR_A_BLANK) {
          return;
        }

        context.report({
          node: statement,
          messageId: "missingBlankLine",
          fix: (fixer) => fixer.insertTextAfter(last, "\n"),
        });
      });
    }

    return {
      FunctionDeclaration: checkBody,
      FunctionExpression: checkBody,
      ArrowFunctionExpression: checkBody,
    };
  },
};
