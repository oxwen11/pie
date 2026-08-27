import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noVoidExpression } from "./no-void-expression";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const jsxTester = new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
});

tester.run("no-void-expression", noVoidExpression, {
  valid: [
    "foo();",
    "foo().catch((error: unknown) => console.error(error));",
    "() => foo();",
    "import('x');",
    "(async () => { await bar(); })();",
    "function f(): void { return; }",
    "async function g(): Promise<void> { return; }",
    "type H = () => void;",
    "foo.void();",
    {
      code: `function skip(event: { type: "a" | "b" }) {
  switch (event.type) {
    case "a":
    case "b":
      break;
    default:
      void (event.type satisfies never);
  }
}`,
    },
    {
      code: `function skipListed(event: { type: "keep" | "drop" | "echo" }) {
  switch (event.type) {
    case "keep":
      break;
    default:
      void (event.type satisfies "drop" | "echo");
  }
}`,
    },
  ],
  invalid: [
    {
      code: "void foo();",
      output: "foo();",
      errors: [{ message: /Do not prefix expressions with void/ }],
    },
    {
      code: "if (ok) void foo();",
      output: "if (ok) foo();",
      errors: [{ message: /Do not prefix expressions with void/ }],
    },
    {
      code: "void foo().catch((error: unknown) => console.error(error));",
      output: "foo().catch((error: unknown) => console.error(error));",
      errors: [{ message: /Do not prefix expressions with void/ }],
    },
    {
      code: "() => void foo();",
      output: "() => foo();",
      errors: [{ message: /Do not prefix expressions with void/ }],
    },
    {
      code: "void import('x');",
      output: "import('x');",
      errors: [{ message: /Do not prefix expressions with void/ }],
    },
    {
      code: `void (async () => {
  await bar();
})();`,
      output: `(async () => {
  await bar();
})();`,
      errors: [{ message: /Do not prefix expressions with void/ }],
    },
    {
      code: `void chats
  .chatFor(ref)
  .prompt(text);`,
      output: `chats
  .chatFor(ref)
  .prompt(text);`,
      errors: [{ message: /Do not prefix expressions with void/ }],
    },
    {
      code: `const live = 1;
void live;`,
      errors: [{ message: /Prefix the binding with _/ }],
    },
    {
      code: "const x = void foo();",
      errors: [{ message: /Do not prefix expressions with void/ }],
    },
    {
      code: "return void foo();",
      errors: [{ message: /Do not prefix expressions with void/ }],
    },
  ],
});

jsxTester.run("no-void-expression jsx", noVoidExpression, {
  valid: [
    {
      filename: "button.tsx",
      code: "const el = <button onClick={() => foo()} />;",
    },
  ],
  invalid: [
    {
      filename: "button.tsx",
      code: "const el = <button onClick={() => void foo()} />;",
      output: "const el = <button onClick={() => foo()} />;",
      errors: [{ message: /Do not prefix expressions with void/ }],
    },
  ],
});
