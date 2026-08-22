import assert from "node:assert/strict";

import { it } from "@effect/vitest";
import { Effect } from "effect";

import type { HarnessAgentAdapter } from "../../src/harness/adapter";
import { makeHarnessAgentRegistry } from "../../src/harness/registry";

const piAdapter = {
  id: "pi",
  descriptor: { id: "pi", name: "Pi" },
  checkAvailability: Effect.succeed({ available: true }),
  permissionModes: [],
  getSessionInfo: () => Effect.succeed({ _tag: "unsupported" as const }),
  open: () => Effect.die("not used"),
  resume: () => Effect.die("not used"),
} satisfies HarnessAgentAdapter;

it.effect("lists adapters and resolves them by harness agent id", () =>
  Effect.gen(function* () {
    const registry = makeHarnessAgentRegistry([piAdapter]);

    assert.deepEqual(yield* registry.list, [piAdapter.descriptor]);
    assert.equal(yield* registry.get("pi"), piAdapter);
  }),
);

it.effect("returns a typed error for an unregistered harness agent", () =>
  Effect.gen(function* () {
    const registry = makeHarnessAgentRegistry([]);
    const error = yield* registry.get("pi").pipe(Effect.flip);

    assert.equal(error._tag, "HarnessAgentNotFound");
    assert.equal(error.harnessAgentId, "pi");
  }),
);
