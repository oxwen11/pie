import { AutomationSchema, type Automation } from "@getpie/contract";
import { type JsonStoreLoadError, makeJsonCollection } from "@getpie/effect-json-store";
import { Context, Effect, FileSystem, Layer, Option } from "effect";

import { Paths } from "../config/paths";
import { AutomationNotFound, StoreReadError, StoreWriteError } from "../errors";

export class AutomationRepository extends Context.Service<
  AutomationRepository,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<Automation>, StoreReadError>;
    readonly read: (id: string) => Effect.Effect<Automation, StoreReadError | AutomationNotFound>;
    readonly write: (automation: Automation) => Effect.Effect<void, StoreWriteError>;
    readonly remove: (id: string) => Effect.Effect<void, StoreWriteError>;
  }
>()("AutomationRepository") {}

const isSafeId = (id: string): boolean =>
  id.length > 0 && !/[/\\]/.test(id) && id !== "." && id !== "..";

export const AutomationRepositoryLayer: Layer.Layer<
  AutomationRepository,
  never,
  Paths | FileSystem.FileSystem
> = Layer.effect(
  AutomationRepository,
  Effect.gen(function* () {
    const paths = yield* Paths;
    const automations = yield* makeJsonCollection({
      dir: paths.automationsDir,
      schema: AutomationSchema,
    });
    const asReadError = (error: JsonStoreLoadError) =>
      new StoreReadError({ file: error.file, cause: error });
    const asWriteError = (error: { readonly file: string }) =>
      new StoreWriteError({ file: error.file, cause: error });

    return {
      list: () =>
        automations.list().pipe(
          Effect.map((entries) => entries.map((entry) => entry.data)),
          Effect.mapError(asReadError),
        ),
      read: (id) =>
        !isSafeId(id)
          ? Effect.fail(new AutomationNotFound({ automationId: id }))
          : automations.get(id).pipe(
              Effect.mapError(asReadError),
              Effect.flatMap((found) =>
                Option.isSome(found)
                  ? Effect.succeed(found.value)
                  : Effect.fail(new AutomationNotFound({ automationId: id })),
              ),
            ),
      write: (automation) =>
        automations.put(automation.id, automation).pipe(Effect.mapError(asWriteError)),
      remove: (id) =>
        !isSafeId(id) ? Effect.void : automations.remove(id).pipe(Effect.mapError(asWriteError)),
    };
  }),
);
