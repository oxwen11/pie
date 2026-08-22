import "@orpc/experimental-effect/extensions/effect";
import { implement } from "@orpc/server";
import { agentContract } from "@pie/contract/agent";
import { Effect } from "effect";

import { HarnessAgentService } from "../harness";
import { ProjectService } from "../project";
import type { RpcContext } from "./context";

const orpc = implement(agentContract).$context<RpcContext>();

export const agentRouter = orpc.router({
  listModels: orpc.listModels.effect(function* ({ input, errors }) {
    const projects = yield* ProjectService;
    const agent = yield* HarnessAgentService;
    return yield* projects.findById(input.projectId).pipe(
      Effect.flatMap((project) => agent.listModels(project.path)),
      Effect.map((models) => ({ models })),
      Effect.catchTags({
        ProjectNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
        AgentOperationError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
      }),
    );
  }),
});

export type AgentRouter = typeof agentRouter;
