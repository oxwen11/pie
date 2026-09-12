import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noNodeModulesImport } from "./no-node-modules-import";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const banned = {
  message:
    /Do not import through node_modules\. Import the package by name instead of a relative path/,
};

tester.run("no-node-modules-import", noNodeModulesImport, {
  valid: [
    { code: `import { useState } from "react";` },
    { code: `import { SessionRef } from "@getpie/contract";` },
    { code: `import fs from "node:fs/promises";` },
    { code: `import { local } from "./local";` },
    { code: `import { parent } from "../parent";` },
    { code: `export { local } from "./local";` },
    { code: `export * from "../parent";` },
    { code: `const mod = await import("./local");` },
    { code: `const fs = require("node:fs");` },
    { code: `import foo = require("foo");` },
    { code: `const path = "../../../../node_modules/foo";` },
    { code: `// ../../../../node_modules/foo` },
  ],
  invalid: [
    {
      code: `import lodash from "../../../../node_modules/lodash";`,
      errors: [banned],
    },
    {
      code: `import type { Foo } from "../../../../node_modules/foo";`,
      errors: [banned],
    },
    {
      code: `import lodash from "../../../../node_modules";`,
      errors: [banned],
    },
    {
      code: `import lodash from "../node_modules/lodash";`,
      errors: [banned],
    },
    {
      code: `import lodash from "./node_modules/lodash";`,
      errors: [banned],
    },
    {
      code: `import lodash from "node_modules/lodash";`,
      errors: [banned],
    },
    {
      code: `export { map } from "../../../../node_modules/lodash";`,
      errors: [banned],
    },
    {
      code: `export * from "../../../../node_modules/lodash";`,
      errors: [banned],
    },
    {
      code: `const lodash = await import("../../../../node_modules/lodash");`,
      errors: [banned],
    },
    {
      code: `const lodash = require("../../../../node_modules/lodash");`,
      errors: [banned],
    },
    {
      code: `import lodash = require("../../../../node_modules/lodash");`,
      errors: [banned],
    },
    {
      code: `import lodash from "..\\\\..\\\\node_modules\\\\lodash";`,
      errors: [banned],
    },
  ],
});
