import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noModuleMutableState } from "./no-module-mutable-state";

RuleTester.describe = describe;
RuleTester.it = it;

const appFile = "apps/app/src/features/terminal/terminal-panel.tsx";
const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const error = {
  message:
    /UI modules must not declare module-level let\/var. Mint identities with crypto.randomUUID()/,
};

tester.run("no-module-mutable-state", noModuleMutableState, {
  valid: [
    {
      filename: appFile,
      code: `const GREETING = ["$ pnpm dev"];
export const terminalPanel = { newPayload: () => ({ terminalId: crypto.randomUUID() }) };`,
    },
    {
      filename: appFile,
      code: `export function create() {
  let n = 0;
  return () => ++n;
}`,
    },
    {
      filename: appFile,
      code: `for (let i = 0; i < 3; i += 1) {}`,
    },
    {
      filename: "apps/app/src/features/demo.test.ts",
      code: `let root: unknown;
let container: unknown;`,
    },
    {
      filename: "packages/server/src/session.ts",
      code: `let next = 0;
export const alloc = () => ++next;`,
    },
    {
      filename: "apps/desktop/src/main/index.ts",
      code: `let mainWindow: unknown;`,
    },
    {
      filename: appFile,
      code: `const cache = new Map<string, string>();
export const get = (id: string) => cache.get(id);`,
    },
    {
      filename: appFile,
      code: `declare let process: { env: Record<string, string | undefined> };`,
    },
  ],
  invalid: [
    {
      filename: appFile,
      code: `let nextTerminal = 0;
export const newPayload = () => ({ terminalId: \`terminal-\${++nextTerminal}\` });`,
      errors: [error],
    },
    {
      filename: "apps/app/src/components/layout/content-panel/panels/browser-panel.tsx",
      code: `let nextTab = 0;`,
      errors: [error],
    },
    {
      filename: "packages/ui/src/lib/id.ts",
      code: `var counter = 0;`,
      errors: [error],
    },
    {
      filename: "apps/desktop/src/renderer/desktop-host.ts",
      code: `export let next = 0;`,
      errors: [error],
    },
  ],
});
