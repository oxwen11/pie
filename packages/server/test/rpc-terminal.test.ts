import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { TerminalConnectEvent } from "@getpie/contract";
import { describe, expect, it } from "vitest";

import { makeRpcTestHarness } from "./rpc-harness";

const waitForOutput = async (
  stream: AsyncIterable<TerminalConnectEvent>,
  needle: string,
  timeoutMs = 8_000,
): Promise<string> => {
  let output = "";
  const read = async () => {
    for await (const event of stream) {
      if (event.type === "snapshot") output += event.history;
      if (event.type === "output") output += event.data;
      if (output.includes(needle)) return output;
    }
    throw new Error(`stream ended before ${JSON.stringify(needle)}; saw: ${output}`);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<string>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`timed out waiting for ${JSON.stringify(needle)}; saw: ${output}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

describe("terminal router", () => {
  it("spawns a real shell in the session cwd, isolates two sessions, tombstones a closed id, and kills remaining shells on session delete", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-home-"));
    const workspaceA = fs.mkdtempSync(path.join(os.tmpdir(), "pie-term-a-"));
    const workspaceB = fs.mkdtempSync(path.join(os.tmpdir(), "pie-term-b-"));
    const nonceA = `pie-term-a-${Date.now()}`;
    const nonceB = `pie-term-b-${Date.now()}`;
    fs.writeFileSync(path.join(workspaceA, "marker-a.txt"), nonceA);
    fs.writeFileSync(path.join(workspaceB, "marker-b.txt"), nonceB);

    const harness = await makeRpcTestHarness(home);
    try {
      const projectA = await harness.client.project.create({ path: workspaceA });
      const projectB = await harness.client.project.create({ path: workspaceB });
      const sessionA = await harness.client.agent.session.create({ projectId: projectA.id });
      const sessionB = await harness.client.agent.session.create({ projectId: projectB.id });
      const refA = sessionA.ref;
      const refB = sessionB.ref;

      const streamA = await harness.client.terminal.connect({
        ref: refA,
        terminalId: "term-1",
      });
      const streamB = await harness.client.terminal.connect({
        ref: refB,
        terminalId: "term-1",
      });
      const seenA = waitForOutput(streamA, nonceA);
      const seenB = waitForOutput(streamB, nonceB);

      await harness.client.terminal.write({
        ref: refA,
        terminalId: "term-1",
        data: "cat marker-a.txt\n",
      });
      await harness.client.terminal.write({
        ref: refB,
        terminalId: "term-1",
        data: "cat marker-b.txt\n",
      });

      const outputA = await seenA;
      const outputB = await seenB;
      expect(outputA).toContain(nonceA);
      expect(outputA).not.toContain(nonceB);
      expect(outputB).toContain(nonceB);
      expect(outputB).not.toContain(nonceA);

      await harness.client.terminal.close({ ref: refA, terminalId: "term-1" });
      await expect(
        harness.client.terminal.write({
          ref: refA,
          terminalId: "term-1",
          data: "echo still-alive\n",
        }),
      ).rejects.toMatchObject({ code: "SESSION_NOT_ACTIVE" });
      await expect(
        harness.client.terminal.connect({
          ref: refA,
          terminalId: "term-1",
        }),
      ).rejects.toMatchObject({ code: "SESSION_NOT_ACTIVE" });

      const streamA2 = await harness.client.terminal.connect({
        ref: refA,
        terminalId: "term-2",
      });
      const seenA2 = waitForOutput(streamA2, nonceA);
      await harness.client.terminal.write({
        ref: refA,
        terminalId: "term-2",
        data: "cat marker-a.txt\n",
      });
      await expect(seenA2).resolves.toContain(nonceA);

      await harness.client.agent.session.delete({ ref: refA });
      await expect(
        harness.client.terminal.write({
          ref: refA,
          terminalId: "term-2",
          data: "echo still-alive\n",
        }),
      ).rejects.toMatchObject({ code: "SESSION_NOT_ACTIVE" });
    } finally {
      await harness.dispose();
    }
  }, 30_000);
});
