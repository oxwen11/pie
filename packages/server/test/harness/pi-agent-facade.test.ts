import { expect, it } from "vitest";

import { makePiAgent, type PiAgentShape } from "../../src/harness/pi/facade";
import type { PiProcess } from "../../src/harness/pi/process";

const stub = <T>() => ({}) as T;

it("declaring the Pi facade never touches the process", () => {
  expect(() => makePiAgent(stub<PiProcess>())).not.toThrow();
});

it("Pi facade exposes create and resume", () => {
  const pi: PiAgentShape = makePiAgent(stub<PiProcess>());
  expect(typeof pi.create).toBe("function");
  expect(typeof pi.resume).toBe("function");
});
