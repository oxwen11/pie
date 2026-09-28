import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noDotFilename } from "./no-dot-filename";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const error = { messageId: "generic" };

const named = (filename: string) => ({ code: `const x = 1;`, filename });

tester.run("no-dot-filename", noDotFilename, {
  valid: [
    named("/repo/apps/app/src/message-view.ts"),
    named("/repo/apps/app/src/message-view.test.ts"),
    named("/repo/apps/app/src/message-view.test-d.ts"),
    named("/repo/apps/app/src/message-view.spec.tsx"),
    named("/repo/apps/app/vitest.config.ts"),
    named("/repo/apps/app/vitest.browser.config.ts"),
    named("/repo/apps/app/src/product-flows.e2e.test.tsx"),
    named("/repo/apps/app/src/agent.smoke.test.ts"),
    named("/repo/apps/app/src/vite-env.d.ts"),
    named("/repo/apps/app/src/routeTree.gen.ts"),
    named("/repo/apps/desktop/electron.vite.config.ts"),
  ],
  invalid: [
    {
      code: `const x = 1;`,
      filename: "/repo/apps/app/src/features/chat/transcript/message-view.logic.ts",
      errors: [error],
    },
    {
      code: `const x = 1;`,
      filename: "/repo/apps/app/src/message-view.logic.test.ts",
      errors: [error],
    },
    {
      code: `const x = 1;`,
      filename: "/repo/apps/app/vitest.shared.ts",
      errors: [error],
    },
  ],
});
