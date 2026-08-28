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

const hasPiAuth =
  Boolean(process.env.ANTHROPIC_API_KEY) ||
  Boolean(process.env.OPENAI_API_KEY) ||
  fs.existsSync(path.join(os.homedir(), ".pi/agent/auth.json"));

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
  it.skipIf(!hasPiAuth)(
    "creates a project and runs one real turn over the server API",
    async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-live-api-home-"));
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pie-live-api-ws-"));
      previousHome = process.env.PIE_HOME;
      process.env.PIE_HOME = home;

      server = await createServer({ effectContext: await discardContext() });
      await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      const base = `http://127.0.0.1:${port}`;

      const health = await fetch(`${base}/api/health`);
      expect(health.status).toBe(200);
      expect(await health.text()).toBe("ok");

      const link = new WebSocketRPCLink({
        connect: async () => new WebSocket(`ws://127.0.0.1:${port}/ws/rpc`, "pie"),
      });
      const client: RouterContractClient<Contract> = createORPCClient(link);

      const project = await client.project.create({ path: workspace });
      const ref = await client.agent.session.create({ projectId: project.id });
      const events = await client.agent.session.subscribe({
        scope: { kind: "session", ref },
      });
      const receipt = await client.agent.session.prompt({
        ref,
        parts: [{ type: "text", text: "Reply with exactly: PONG" }],
      });

      const chunks: Array<{ type: string; delta?: string }> = [];
      const deadline = Date.now() + 170_000;
      for await (const item of events) {
        if (Date.now() > deadline) throw new Error("timed out waiting for the turn to end");
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
    180_000,
  );
});
