import type { Effect, Scope, Stream } from "effect";
import { expectTypeOf, test } from "vitest";

import type {
  AgentOpenError,
  AgentOperationError,
  AgentUnavailable,
  ExecutableNotFound,
  PiAgentShape,
  PiAgentRuntime,
  PromptReceipt,
  SessionClosed,
  TurnAlreadyRunning,
} from "../../src/harness";

test("Pi facade open is scoped and effect native", () => {
  expectTypeOf<PiAgentShape["open"]>().returns.toEqualTypeOf<
    Effect.Effect<
      PiAgentRuntime,
      AgentUnavailable | ExecutableNotFound | AgentOpenError,
      Scope.Scope
    >
  >();
});

test("session operations expose Effect and Stream only", () => {
  expectTypeOf<PiAgentRuntime["events"]>().toMatchTypeOf<Stream.Stream<unknown, unknown>>();
  expectTypeOf<ReturnType<PiAgentRuntime["prompt"]>>().toEqualTypeOf<
    Effect.Effect<PromptReceipt, SessionClosed | TurnAlreadyRunning | AgentOperationError>
  >();
  expectTypeOf<PiAgentRuntime["close"]>().toEqualTypeOf<Effect.Effect<void>>();
});
