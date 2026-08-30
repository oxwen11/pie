import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import type { Contract } from "@getpie/contract";
import { createORPCClient } from "@orpc/client";
import { RPCLink as WebSocketRPCLink } from "@orpc/client/websocket";
import type { RouterContractClient } from "@orpc/contract";
import { afterEach, describe, expect, it } from "vitest";

import { createServer, type ManagedServer } from "../../src/http/server";
import { discardContext } from "../platform";

const runLivePiTests = process.env.PIE_LIVE_TESTS === "1";

const withTimeout = async <A>(promise: Promise<A>, timeoutMs: number): Promise<A> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("timed out waiting for a session event")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

let server: ManagedServer | undefined;
let previousHome: string | undefined;

afterEach(async () => {
  await server?.dispose();
  server = undefined;
  if (previousHome === undefined) delete process.env.PIE_HOME;
  else process.env.PIE_HOME = previousHome;
  previousHome = undefined;
});

describe("live HTTP/WebSocket session", () => {
  it.skipIf(!runLivePiTests)(
    "creates a project and runs one real turn over the server API",
    async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-live-api-home-"));
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pie-live-api-ws-"));
      previousHome = process.env.PIE_HOME;
      process.env.PIE_HOME = home;

      const live = await createServer({ effectContext: await discardContext() });
      server = live;
      await new Promise<void>((resolve) => {
        live.listen(0, "127.0.0.1", resolve);
      });
      const { port } = live.address() as AddressInfo;
      const base = `http://127.0.0.1:${port}`;

      const health = await fetch(`${base}/api/health`);
      expect(health.status).toBe(200);
      await expect(health.text()).resolves.toBe("ok");

      const link = new WebSocketRPCLink({
        connect: async () => new WebSocket(`ws://127.0.0.1:${port}/ws/rpc`, "pie"),
      });
      const client: RouterContractClient<Contract> = createORPCClient(link);

      const project = await client.project.create({ path: workspace });
      const { ref } = await client.agent.session.create({ projectId: project.id });
      const events = await client.agent.session.subscribe({
        scope: { kind: "session", ref },
      });
      const attached = await client.agent.session.getSnapshot({ ref });
      expect(attached.cursor).toBe(0);
      const iterator = events[Symbol.asyncIterator]();
      let pendingEvent = iterator.next();
      const receipt = await client.agent.session.prompt({
        ref,
        parts: [{ type: "text", text: "Reply with exactly: PONG" }],
      });

      const chunks: Array<{ type: string; delta?: string }> = [];
      const deadline = Date.now() + 60_000;
      while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("timed out waiting for the turn to end");
        const next = await withTimeout(pendingEvent, remaining);
        if (next.done) throw new Error("session event stream closed before the turn ended");
        pendingEvent = iterator.next();
        const item = next.value;
        if (item.type !== "event") continue;
        const event = item.event;
        if (event.type === "session.message.chunk") {
          chunks.push(
            event.chunk.type === "text-delta"
              ? { type: event.chunk.type, delta: event.chunk.delta }
              : { type: event.chunk.type },
          );
        }
        if (event.type === "session.turn.ended" && event.turnId === receipt.turnId) break;
      }

      const text = chunks
        .filter((chunk) => chunk.type === "text-delta")
        .map((chunk) => chunk.delta ?? "")
        .join("");
      expect(text).toMatch(/PONG/i);
      expect(chunks.at(-1)?.type).toBe("finish");

      await client.agent.session.close({ ref });
    },
    70_000,
  );
});
