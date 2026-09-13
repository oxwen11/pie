import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noLet } from "./no-let";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const error = { messageId: "generic" };

tester.run("no-let", noLet, {
  valid: [
    { code: `const x = 1;` },
    { code: `export const x = 1;` },
    { code: `declare let process: { env: Record<string, string | undefined> };` },
    {
      code: `function alloc() {
  let n = 0;
  return () => ++n;
}`,
      options: [{ allowInFunctions: true }],
    },
    {
      code: `for (let i = 0; i < 3; i += 1) {}`,
      options: [{ allowInForLoopInit: true }],
    },
  ],
  invalid: [
    { code: `let next = 0;`, errors: [error] },
    { code: `export let next = 0;`, errors: [error] },
    {
      code: `function alloc() {
  let n = 0;
  return () => ++n;
}`,
      errors: [error],
    },
    {
      code: `for (let i = 0; i < 3; i += 1) {}`,
      errors: [error],
    },
    {
      code: `let nextTerminal = 0;
export const newPayload = () => ({ terminalId: \`terminal-\${++nextTerminal}\` });`,
      options: [{ allowInFunctions: true, allowInForLoopInit: true }],
      errors: [error],
    },
  ],
});
