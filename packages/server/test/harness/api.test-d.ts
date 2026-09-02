import type { Effect, FileSystem, Scope, Stream } from "effect";
import { expectTypeOf, test } from "vitest";

import type {
  AgentOpenError,
  AgentOperationError,
  AgentUnavailable,
  ExecutableNotFound,
  PiAgentShape,
  PiAgentRuntime,
  RuntimePromptReceipt,
  SessionClosed,
  TurnAlreadyRunning,
} from "../../src/harness";

test("PiAgent create is scoped and effect native", () => {
  expectTypeOf<PiAgentShape["create"]>().returns.toEqualTypeOf<
    Effect.Effect<
      PiAgentRuntime,
      AgentUnavailable | ExecutableNotFound | AgentOpenError,
      Scope.Scope | FileSystem.FileSystem
    >
  >();
});

test("session operations expose Effect and Stream only", () => {
  expectTypeOf<PiAgentRuntime["events"]>().toMatchTypeOf<Stream.Stream<unknown, unknown>>();
  expectTypeOf<ReturnType<PiAgentRuntime["prompt"]>>().toEqualTypeOf<
    Effect.Effect<RuntimePromptReceipt, SessionClosed | TurnAlreadyRunning | AgentOperationError>
  >();
  expectTypeOf<PiAgentRuntime["close"]>().toEqualTypeOf<Effect.Effect<void>>();
});
