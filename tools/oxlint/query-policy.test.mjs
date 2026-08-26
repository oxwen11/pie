import test from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import { noQueryClientDefaultOverrides, noThinUseQueryHook } from "./query-policy.mjs";

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
useQuery({ ...orpc.git.branch.queryOptions({ input }), retry: false, refetchOnWindowFocus: false });`,
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

tester.run("no-thin-use-query-hook", noThinUseQueryHook, {
  valid: [
    {
      filename,
      code: `import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
export function Panel() {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  return useQuery(orpcQueryUtils.project.list.queryOptions());
}`,
    },
    {
      filename,
      code: `import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
function useProjectListQuery(select) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  return useQuery({ ...orpcQueryUtils.project.list.queryOptions(), select });
}
export function useProjects() { return useProjectListQuery(selectOrdered); }
export function useProject(id) { return useProjectListQuery((projects) => projects.find((p) => p.id === id)); }`,
    },
    {
      filename,
      code: `import { useMutation, useQuery } from "@tanstack/react-query";
export function useSessionModels(ref) {
  const models = useQuery(orpc.agent.listModels.queryOptions({ input: { projectId: ref.projectId } }));
  const setModel = useMutation({ mutationFn: () => undefined });
  return { models, setModel };
}`,
    },
    {
      filename,
      code: `import { useQuery } from "@tanstack/react-query";
export function useProjectSessionTitle(ref) {
  const active = useQuery({ enabled: true });
  const archived = useQuery({ enabled: false });
  return active.data ?? archived.data;
}`,
    },
    {
      filename,
      code: `import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
export function useDraftWorktree(selected) {
  const [mode, setMode] = useState("project");
  const gitBranch = useQuery({ retry: false, refetchOnWindowFocus: false });
  return { mode, setMode, gitBranch };
}`,
    },
    {
      filename: "packages/ui/src/hooks/use-models.ts",
      code: `import { useQuery } from "@tanstack/react-query";
export function useGitBranch(workspace) {
  return useQuery(orpc.git.branch.queryOptions({ input: workspace }));
}`,
    },
  ],
  invalid: [
    {
      filename,
      code: `import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
export function useGitBranch(workspace) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  return useQuery(orpcQueryUtils.git.branch.queryOptions({ input: workspace }));
}`,
      errors: [{ message: /Do not wrap a bare useQuery in a hook/ }],
    },
    {
      filename,
      code: `import { useQuery } from "@tanstack/react-query";
export const useAgentModels = (projectId) =>
  useQuery(orpc.agent.listModels.queryOptions({ input: projectId ? { projectId } : {} }));`,
      errors: [{ message: /Do not wrap a bare useQuery in a hook/ }],
    },
  ],
});
