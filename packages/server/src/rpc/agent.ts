import os from "node:os";

import { agentContract } from "@getpie/contract/agent";
import { Effect } from "effect";

import { listAvailablePiModels } from "../harness/pi/list-available-models";
import { ProjectService } from "../project";
import type { RpcContext } from "./context";
import { agentOperation, projectNotFound } from "./errors";
import { implement } from "./orpc";
import { sessionRouter } from "./session";

const orpc = implement(agentContract).$context<RpcContext>();

export const agentRouter = orpc.router({
  listModels: orpc.listModels.effect(function* ({ input, errors }) {
    const projectId = input.projectId;
    const cwd = projectId
      ? yield* ProjectService.pipe(
          Effect.flatMap((projects) =>
            projects.findById(projectId).pipe(
              Effect.map((project) => project.path),
              Effect.catchTags({
                ProjectNotFound: projectNotFound(errors),
              }),
            ),
          ),
        )
      : os.homedir();

    return yield* listAvailablePiModels(cwd).pipe(
      Effect.catchTags({
        AgentOperationError: agentOperation(errors),
      }),
    );
  }),
  session: sessionRouter,
});

export type AgentRouter = typeof agentRouter;
