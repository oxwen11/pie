import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { HarnessAgentAdapter } from "../src/harness";
import { makeRpcTestHarness } from "./rpc-harness";

const fakeAdapter = (over: {
  id: HarnessAgentAdapter["id"];
  name: string;
  available: boolean;
  reason?: string;
}): HarnessAgentAdapter => ({
  id: over.id,
  descriptor: { id: over.id, name: over.name },
  checkAvailability: Effect.succeed(
    over.reason
      ? { available: over.available, reason: over.reason }
      : { available: over.available },
  ),
  permissionModes: [],
  open: () => Effect.die("list must not open a session"),
  resume: () => Effect.die("list must not resume a session"),
  getSessionInfo: () => Effect.succeed({ _tag: "unsupported" as const }),
});

describe("harness router", () => {
  it("lists pi availability and permission subset in one call", async () => {
    const adapters: ReadonlyArray<HarnessAgentAdapter> = [
      fakeAdapter({ id: "pi", name: "Pi", available: true }),
    ];
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "pie-rpc-harness-"));
    const { client, dispose } = await makeRpcTestHarness(home, adapters);
    try {
      const { harnessAgents } = await client.harness.list({});

      expect(harnessAgents.map((agent) => agent.id)).toEqual(["pi"]);

      const pi = harnessAgents.find((agent) => agent.id === "pi");
      expect(pi).toMatchObject({ name: "Pi", available: true });
      expect(pi?.reason).toBeUndefined();
      expect(pi?.permissionModes).toEqual([]);
    } finally {
      await dispose();
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});
