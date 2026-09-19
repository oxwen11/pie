import os from "node:os";

import { agentContract } from "@getpie/contract/agent";
import { Effect } from "effect";

import { PiAgentService } from "../harness";
import { ProjectService } from "../project";
import type { RpcContext } from "./context";
import { implement } from "./orpc";
import { sessionRouter } from "./session";

const orpc = implement(agentContract).$context<RpcContext>();

export const agentRouter = orpc.router({
  listModels: orpc.listModels.effect(function* ({ input, errors }) {
    const agent = yield* PiAgentService;
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
