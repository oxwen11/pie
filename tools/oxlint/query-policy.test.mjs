import test from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import { noQueryClientDefaultOverrides } from "./query-policy.mjs";

RuleTester.describe = test.describe;
RuleTester.it = test.it;

const filename = "apps/app/src/features/demo.ts";
const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

tester.run("no-query-client-default-overrides", noQueryClientDefaultOverrides, {
  valid: [
    {
      filename,
      code: `import { useQuery } from "@tanstack/react-query";
useQuery(orpc.project.list.queryOptions());`,
    },
    {
      filename,
      code: `import { useQuery } from "@tanstack/react-query";
useQuery({
  ...orpc.git.branch.queryOptions({ input }),
  enabled: input !== null,
  select,
  retry: false,
  refetchOnWindowFocus: false,
  staleTime: 30_000,
});`,
    },
    {
      filename: "apps/app/src/lib/orpc.ts",
      code: `const queryDefaults = { staleTime: Infinity, refetchOnWindowFocus: "always" as const };`,
    },
    {
      filename: "apps/app/src/lib/orpc.test.ts",
      code: `import { useQuery } from "@tanstack/react-query";
useQuery({ staleTime: Infinity, refetchOnWindowFocus: "always" as const });`,
    },
    {
      filename: "packages/server/src/session.ts",
      code: `import { useQuery } from "@tanstack/react-query";
useQuery({ staleTime: Infinity });`,
    },
  ],
  invalid: [
    {
      filename,
      code: `import { useQuery } from "@tanstack/react-query";
useQuery({ staleTime: Infinity });`,
      errors: [{ message: /staleTime: Infinity is set in createAppClients/ }],
    },
    {
      filename,
      code: `import { useQuery } from "@tanstack/react-query";
useQuery({ refetchOnWindowFocus: "always" as const });`,
      errors: [{ message: /refetchOnWindowFocus: "always" is set in createAppClients/ }],
    },
    {
      filename,
      code: `import { useQueries } from "@tanstack/react-query";
useQueries({ queries: files.map((file) => ({ staleTime: Infinity })) });`,
      errors: [{ message: /staleTime: Infinity is set in createAppClients/ }],
    },
  ],
});
