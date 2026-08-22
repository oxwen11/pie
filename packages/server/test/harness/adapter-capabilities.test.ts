import { expect, it } from "vitest";

import { makePiAdapter, type PiAgent } from "../../src/harness/pi";

const stub = <T>() => ({}) as T;

it("pi declares an empty permission subset and no default", () => {
  const adapter = makePiAdapter(stub<PiAgent>());

  expect(adapter.permissionModes).toEqual([]);
  expect(adapter.defaultPermissionMode).toBeUndefined();
});

it("pi has no model probe", () => {
  expect(makePiAdapter(stub<PiAgent>()).probeModels).toBeUndefined();
});

it("declaring an adapter never touches its agent", () => {
  expect(() => makePiAdapter(stub<PiAgent>())).not.toThrow();
});
