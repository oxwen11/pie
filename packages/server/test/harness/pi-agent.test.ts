import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect } from "effect";
import { expect, it } from "vitest";

import { makePiAgent } from "../../src/harness/pi/agent";
import type { PiProcess } from "../../src/harness/pi/process";

const stubProcess = {} as PiProcess;

it("makePiAgent never touches the process", async () => {
  const pi = await Effect.runPromise(
    makePiAgent(stubProcess).pipe(Effect.provide(NodeFileSystem.layer)),
  );
  expect(pi.create).toBeTypeOf("function");
  expect(pi.resume).toBeTypeOf("function");
});
