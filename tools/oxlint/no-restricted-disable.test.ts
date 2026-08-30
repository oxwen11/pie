import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noRestrictedDisable } from "./no-restricted-disable";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

tester.run("no-restricted-disable", noRestrictedDisable, {
  valid: [
    {
      code: `const x = 1;
// oxlint-disable-next-line unicorn/no-array-sort -- fresh array
x.toSorted();`,
    },
    {
      code: `// eslint-disable-next-line @typescript-eslint/no-explicit-any
const value: any = 1;`,
    },
    {
      code: `/* oxlint-disable anti-slop/no-chained-type-assertions */
const n = 1 as unknown as number;`,
    },
    {
      code: `// not a disable directive
const ok = true;`,
    },
  ],
  invalid: [
    {
      code: `// eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler
setState(true);`,
      errors: [
        {
          message:
            /Do not disable react-you-might-not-need-an-effect\/no-event-handler with a comment/,
        },
      ],
    },
    {
      code: `// oxlint-disable-next-line react-you-might-not-need-an-effect/no-external-store-subscription -- editor lifetime
setController(created);`,
      errors: [
        {
          message:
            /Do not disable react-you-might-not-need-an-effect\/no-external-store-subscription with a comment/,
        },
      ],
    },
    {
      code: `// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => {}, []);`,
      errors: [{ message: /Do not disable react-hooks\/exhaustive-deps with a comment/ }],
    },
    {
      code: `// eslint-disable-next-line react/exhaustive-deps, no-console
useEffect(() => {}, []);`,
      errors: [{ message: /Do not disable react\/exhaustive-deps with a comment/ }],
    },
    {
      code: `/* eslint-disable */
const x = 1;`,
      errors: [{ message: /blanket eslint\/oxlint-disable/ }],
    },
    {
      code: `// oxlint-disable-next-line pie/no-restricted-disable
const x = 1;`,
      errors: [{ message: /Do not disable pie\/no-restricted-disable with a comment/ }],
    },
  ],
});
