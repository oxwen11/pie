import os from "node:os";

import { agentContract } from "@getpie/contract/agent";
import { Effect } from "effect";

import { PiAgentService } from "../harness";
import { ProjectService } from "../project";
import type { RpcContext } from "./context";
import { implement } from "./orpc";
import { sessionRouter } from "./session";

const orpc = implement(agentContract).$context<RpcContext>();

const catalogCwd = <E extends { NOT_FOUND: (input: { message: string }) => unknown }>(
  projectId: string | undefined,
  errors: E,
) =>
  projectId
    ? ProjectService.pipe(
        Effect.flatMap((projects) =>
          projects.findById(projectId).pipe(
            Effect.map((project) => project.path),
            Effect.catchTags({
              ProjectNotFound: (e) =>
                Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
            }),
          ),
        ),
      )
    : Effect.succeed(os.homedir());

export const agentRouter = orpc.router({
  listModels: orpc.listModels.effect(function* ({ input, errors }) {
    const agent = yield* PiAgentService;
    const cwd = yield* catalogCwd(input.projectId, errors);

    return yield* agent.listModels(cwd).pipe(
      Effect.catchTags({
        AgentOperationError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
      }),
    );
  }),
  setDefaultModel: orpc.setDefaultModel.effect(function* ({ input, errors }) {
    const agent = yield* PiAgentService;
    const cwd = yield* catalogCwd(input.projectId, errors);

    return yield* agent
      .setDefaultModel(cwd, {
        provider: input.provider,
        modelId: input.modelId,
      })
      .pipe(
        Effect.catchTags({
          AgentOperationError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
        }),
      );
  }),
  session: sessionRouter,
});

export type AgentRouter = typeof agentRouter;
