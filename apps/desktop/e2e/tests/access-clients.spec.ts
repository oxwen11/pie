import childProcess from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { createPieClient } from "../../../../packages/client/src/index.js";
import { PROJECT_ID, seedProject } from "./fixtures.js";

test.use({ trace: "off", screenshot: "off", video: "off" });

const repoRoot = path.join(import.meta.dirname, "../../../..");
const fakePi = path.join(repoRoot, "tools/testing/fake-pi.mjs");
const master = "e2e-master-value";

function ticketedSocket(url: string): Promise<WebSocket> {
  return Promise.resolve(new WebSocket(url, "pie"));
}

async function waitUntil(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
  throw new Error("Timed out waiting for client events");
}

// oxlint-disable-next-line no-empty-pattern -- required by Playwright's fixture API
test("master and browser principals share one RPC session runtime", async ({}, testInfo) => {
  const home = testInfo.outputPath("pie-home");
  seedProject(home, testInfo.outputPath("workspace"));
  const server = childProcess.spawn(
    path.join(repoRoot, "node_modules/.bin/tsx"),
    [path.join(repoRoot, "packages/pie/src/node/cli.ts"), "serve"],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
        PIE_AUTH_TOKEN: master,
        PIE_PORT: "0",
        PIE_HOME: home,
        PIE_E2E: "1",
        PIE_E2E_PI_EXECUTABLE: fakePi,
        PIE_E2E_PI_LOG: testInfo.outputPath("fake-pi.jsonl"),
        PIE_E2E_PI_RESPONSE: "Access client reply",
        PIE_E2E_PI_DELAY_MS: "100",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  try {
    const address = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error("Server did not become ready")), 30_000);
      const scan = (chunk: Buffer) => {
        output += chunk.toString();
        const ready = output.match(/pie:ready\s*({.+})/);
        if (!ready?.[1]) return;
        clearTimeout(timeout);
        const { port } = JSON.parse(ready[1]) as { port: number };
        resolve(`http://127.0.0.1:${port}`);
      };
      server.stdout.on("data", scan);
      server.stderr.on("data", scan);
      server.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Server exited before ready: ${code}`));
      });
    });

    const masterConnect = async () => {
      const response = await fetch(new URL("/api/ws-ticket", address), {
        method: "POST",
        headers: { authorization: `Bearer ${master}` },
      });
      if (!response.ok) throw new Error(`Master ticket request failed: ${response.status}`);
      const body = (await response.json()) as { ticket: string };
      const url = new URL("/ws/rpc", address);
      url.protocol = "ws:";
      url.searchParams.set("ticket", body.ticket);
      return ticketedSocket(url.toString());
    };

    const grantResponse = await fetch(new URL("/api/auth/pairing-grants", address), {
      method: "POST",
      headers: { authorization: `Bearer ${master}` },
    });
    const { grant } = (await grantResponse.json()) as { grant: string };
    const sessionResponse = await fetch(new URL("/api/auth/browser-session", address), {
      method: "POST",
      headers: { "content-type": "application/json", origin: address },
      body: JSON.stringify({ grant }),
    });
    const browserCookie = sessionResponse.headers.get("set-cookie")?.split(";", 1)[0];
    if (!browserCookie) throw new Error("Browser cookie was missing");

    const browserConnect = async () => {
      const response = await fetch(new URL("/api/ws-ticket", address), {
        method: "POST",
        headers: { cookie: browserCookie },
      });
      if (!response.ok) throw new Error(`Browser ticket request failed: ${response.status}`);
      const body = (await response.json()) as { ticket: string };
      const url = new URL("/ws/rpc", address);
      url.protocol = "ws:";
      url.searchParams.set("ticket", body.ticket);
      return ticketedSocket(url.toString());
    };

    const desktop = createPieClient({ connect: masterConnect });
    const browser = createPieClient({ connect: browserConnect });
    const created = await desktop.agent.session.create({ projectId: PROJECT_ID });
    const desktopEvents = await desktop.agent.session.subscribe({
      scope: { kind: "session", ref: created.ref },
    });
    const browserEvents = await browser.agent.session.subscribe({
      scope: { kind: "session", ref: created.ref },
    });
    const desktopEnded: string[] = [];
    const browserEnded: string[] = [];
    const collect = async (events: AsyncIterable<unknown>, ended: string[]) => {
      for await (const item of events) {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "event" &&
          "event" in item
        ) {
          const event = item.event as { type?: string; turnId?: string };
          if (event.type === "session.turn.ended" && event.turnId) ended.push(event.turnId);
        }
        if (ended.length === 2) return;
      }
    };
    const desktopCollector = collect(desktopEvents, desktopEnded);
    const browserCollector = collect(browserEvents, browserEnded);

    await desktop.agent.session.prompt({
      ref: created.ref,
      messageId: "11111111-1111-4111-8111-111111111112",
      parts: [{ type: "text", text: "from desktop principal" }],
    });
    await waitUntil(() => desktopEnded.length === 1 && browserEnded.length === 1);

    await browser.agent.session.prompt({
      ref: created.ref,
      messageId: "11111111-1111-4111-8111-111111111113",
      parts: [{ type: "text", text: "from browser principal" }],
    });
    await Promise.all([desktopCollector, browserCollector]);

    expect(desktopEnded).toHaveLength(2);
    expect(browserEnded).toEqual(desktopEnded);
  } finally {
    server.kill("SIGTERM");
  }
});
