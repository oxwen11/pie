import { expect, it } from "vitest";

import { makePiAdapter, type PiAgent } from "../../src/harness/pi";

const stub = <T>() => ({}) as T;

it("declaring an adapter never touches its agent", () => {
  expect(() => makePiAdapter(stub<PiAgent>())).not.toThrow();
});

it("pi adapter exposes the Pi descriptor", () => {
  expect(makePiAdapter(stub<PiAgent>()).descriptor).toEqual({ name: "Pi" });
});
