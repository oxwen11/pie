import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noModuleMutableState } from "./no-module-mutable-state";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const error = {
  message: /Do not declare module-level let\/var. Function-local let is allowed/,
};

tester.run("no-module-mutable-state", noModuleMutableState, {
  valid: [
    {
      filename: "apps/app/src/features/terminal/terminal-panel.tsx",
      code: `export const newPayload = () => ({ terminalId: crypto.randomUUID() });`,
    },
    {
      filename: "packages/server/src/session.ts",
      code: `export function alloc() {
  let n = 0;
  return () => ++n;
}
for (let i = 0; i < 3; i += 1) {}`,
    },
    {
      filename: "apps/app/src/features/demo.test.ts",
      code: `let root: unknown;
let container: unknown;`,
    },
    {
      filename: "apps/desktop/e2e/tests/multi-client-sync.spec.ts",
      code: `let server: unknown;`,
    },
    {
      filename: "packages/server/src/rpc.ts",
      code: `declare let process: { env: Record<string, string | undefined> };`,
    },
    {
      filename: "apps/app/src/cache.ts",
      code: `const cache = new Map<string, string>();
export const get = (id: string) => cache.get(id);`,
    },
  ],
  invalid: [
    {
      filename: "apps/app/src/features/terminal/terminal-panel.tsx",
      code: `let nextTerminal = 0;
export const newPayload = () => ({ terminalId: \`terminal-\${++nextTerminal}\` });`,
      errors: [error],
    },
    {
      filename: "packages/server/src/harness/pi/rpc/output-guard.ts",
      code: `let stdoutTakeoverState: unknown;
let rawStdoutWriteTail = Promise.resolve();`,
      errors: [error, error],
    },
    {
      filename: "apps/desktop/src/main/desktop-runtime.ts",
      code: `var counter = 0;`,
      errors: [error],
    },
    {
      filename: "packages/server/src/rpc.ts",
      code: `export let next = 0;`,
      errors: [error],
    },
  ],
});
