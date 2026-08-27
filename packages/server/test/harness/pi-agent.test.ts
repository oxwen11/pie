import { expect, it } from "vitest";

import { makePiAgent, type PiAgentShape } from "../../src/harness/pi/agent";
import type { PiProcess } from "../../src/harness/pi/process";

const stub = <T>(): T => ({}) as T;

it("makePiAgent never touches the process", () => {
  expect(() => makePiAgent(stub<PiProcess>())).not.toThrow();
});

it("PiAgent exposes create and resume", () => {
  const pi: PiAgentShape = makePiAgent(stub<PiProcess>());
  expect(typeof pi.create).toBe("function");
  expect(typeof pi.resume).toBe("function");
});
