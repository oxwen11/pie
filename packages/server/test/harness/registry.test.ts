import assert from "node:assert/strict";

import { it } from "@effect/vitest";
import { Effect } from "effect";

import type { HarnessAgentAdapter } from "../../src/harness/adapter";
import { makeHarnessAgentRegistry } from "../../src/harness/registry";

const piAdapter = {
  descriptor: { name: "Pi" },
  checkAvailability: Effect.succeed({ available: true }),
  permissionModes: [],
  getSessionInfo: () => Effect.succeed({ _tag: "unsupported" as const }),
  open: () => Effect.die("not used"),
  resume: () => Effect.die("not used"),
} satisfies HarnessAgentAdapter;

it.effect("exposes the Pi adapter", () =>
  Effect.sync(() => {
    const registry = makeHarnessAgentRegistry(piAdapter);
    assert.equal(registry.adapter, piAdapter);
    assert.deepEqual(registry.adapter.descriptor, { name: "Pi" });
  }),
);
