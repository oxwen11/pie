import "@orpc/experimental-effect/extensions/effect";
import os from "node:os";

import { implement } from "@orpc/server";
import { agentContract } from "@pie/contract/agent";
import { Effect } from "effect";

import { HarnessAgentService } from "../harness";
import { ProjectService } from "../project";
import type { RpcContext } from "./context";
import { sessionRouter } from "./session";

const orpc = implement(agentContract).$context<RpcContext>();

export const agentRouter = orpc.router({
  listModels: orpc.listModels.effect(function* ({ input, errors }) {
    const agent = yield* HarnessAgentService;
    const cwd = input.projectId
      ? yield* ProjectService.pipe(
          Effect.flatMap((projects) =>
            projects.findById(input.projectId!).pipe(
              Effect.map((project) => project.path),
              Effect.catchTags({
                ProjectNotFound: (e) =>
                  Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
              }),
            ),
          ),
        )
      : os.homedir();

    return yield* agent.listModels(cwd).pipe(
      Effect.catchTags({
        AgentOperationError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
      }),
    );
  }),
  session: sessionRouter,
});

export type AgentRouter = typeof agentRouter;
