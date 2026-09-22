import { expect, it } from "vitest";

import { makePiAgent, type PiAgentShape } from "../../src/harness/pi/agent";
import type { PiProcess } from "../../src/harness/pi/process";

const stubProcess = {} as PiProcess;

it("makePiAgent never touches the process", () => {
  expect(() => makePiAgent(stubProcess)).not.toThrow();
});

it("PiAgent exposes create and resume", () => {
  const pi: PiAgentShape = makePiAgent(stubProcess);
  expect(pi.create).toBeTypeOf("function");
  expect(pi.resume).toBeTypeOf("function");
});
