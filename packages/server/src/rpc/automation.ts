import { automationContract } from "@getpie/contract/automation";
import { Effect } from "effect";

import { AutomationService } from "../automation";
import type { RpcContext } from "./context";
import { implement } from "./orpc";

const orpc = implement(automationContract).$context<RpcContext>();

export const automationRouter = orpc.router({
  list: orpc.list.effect(function* () {
    const automations = yield* AutomationService;
    return yield* automations.list();
  }),
  get: orpc.get.effect(function* ({ input, errors }) {
    const automations = yield* AutomationService;
    return yield* automations.get(input.id).pipe(
      Effect.catchTags({
        AutomationNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `automation ${e.automationId} not found` })),
      }),
    );
  }),
  create: orpc.create.effect(function* ({ input, errors }) {
    const automations = yield* AutomationService;
    return yield* automations.create(input).pipe(
      Effect.catchTags({
        ProjectNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `project ${e.projectId} not found` })),
        InvalidAutomation: (e) => Effect.fail(errors.INVALID_ARGUMENT({ message: e.reason })),
        AutomationLimitReached: (e) =>
          Effect.fail(errors.INVALID_ARGUMENT({ message: `already have ${e.limit} automations` })),
      }),
    );
  }),
  update: orpc.update.effect(function* ({ input, errors }) {
    const automations = yield* AutomationService;
    return yield* automations.update(input).pipe(
      Effect.catchTags({
        AutomationNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `automation ${e.automationId} not found` })),
        InvalidAutomation: (e) => Effect.fail(errors.INVALID_ARGUMENT({ message: e.reason })),
      }),
    );
  }),
  delete: orpc.delete.effect(function* ({ input, errors }) {
    const automations = yield* AutomationService;
    yield* automations.delete(input.id).pipe(
      Effect.catchTags({
        AutomationNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `automation ${e.automationId} not found` })),
      }),
    );
  }),
  runNow: orpc.runNow.effect(function* ({ input, errors }) {
    const automations = yield* AutomationService;
    return yield* automations.runNow(input.id).pipe(
      Effect.catchTags({
        AutomationNotFound: (e) =>
          Effect.fail(errors.NOT_FOUND({ message: `automation ${e.automationId} not found` })),
      }),
    );
  }),
});

export type AutomationRouter = typeof automationRouter;
