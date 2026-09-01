import "@orpc/experimental-effect/extensions/effect";
import { agentContract } from "@getpie/contract/agent";
import { implement } from "@orpc/server";
import { Effect } from "effect";

import { PiAgent } from "../harness";
import { ProjectService } from "../project";
import type { RpcContext } from "./context";
import { sessionRouter } from "./session";

const orpc = implement(agentContract).$context<RpcContext>();

export const agentRouter = orpc.router({
  commands: orpc.commands.effect(function* ({ input, errors }) {
    const agent = yield* PiAgent;
    const projectId = input.projectId;
    const cwd = projectId
      ? yield* ProjectService.pipe(
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
      : undefined;

    return yield* agent.commands(cwd).pipe(
      Effect.catchTags({
        AgentDiscoveryError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
      }),
    );
  }),
  listModels: orpc.listModels.effect(function* ({ input, errors }) {
    const agent = yield* PiAgent;
    const projectId = input.projectId;
    const cwd = projectId
      ? yield* ProjectService.pipe(
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
      : undefined;

    return yield* agent.listModels(cwd).pipe(
      Effect.catchTags({
        AgentDiscoveryError: (e) => Effect.fail(errors.INTERNAL({ message: e.message })),
      }),
    );
  }),
  session: sessionRouter,
});

export type AgentRouter = typeof agentRouter;
