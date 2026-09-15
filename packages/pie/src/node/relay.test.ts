import childProcess from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { attachRelay } from "@getpie/server/relay";
import { afterEach, describe, expect, it } from "vitest";

const relayBin = path.join(import.meta.dirname, "../../dist/relay.mjs");
const cliBin = path.join(import.meta.dirname, "../../dist/cli.mjs");

function spawnRelay(args: string[], env: NodeJS.ProcessEnv) {
  return childProcess.spawn(process.execPath, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForListening(child: childProcess.ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      reject(new Error(`pie-relay did not start: ${Buffer.concat(chunks).toString("utf8")}`));
    }, 8000);
    const onExit = (code: number | null) => {
      clearTimeout(timer);
      reject(
        new Error(`pie-relay exited ${String(code)}: ${Buffer.concat(chunks).toString("utf8")}`),
      );
    };
    const onData = (data: Buffer) => {
      chunks.push(data);
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.includes("pie relay listening on ") && text.includes("pie relay control on ")) {
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        child.off("exit", onExit);
        resolve(text);
      }
    };
    child.stdout?.on("data", onData);
    child.once("exit", onExit);
  });
}

describe("pie-relay binary", () => {
  const children: childProcess.ChildProcess[] = [];

  afterEach(() => {
    for (const child of children) child.kill("SIGTERM");
    children.length = 0;
  });

  it("rejects a LAN or Tailscale public-host", async () => {
    const child = spawnRelay([relayBin, "--port", "18443", "--public-host", "192.168.31.135"], {
      PATH: process.env.PATH,
      PIE_RELAY_TOKEN: "relay-token-test",
    });
    children.push(child);
    const output = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const onChunk = (data: Buffer) => {
        chunks.push(data);
      };
      child.stdout?.on("data", onChunk);
      child.stderr?.on("data", onChunk);
      const timer = setTimeout(() => {
        reject(new Error(`pie-relay still running: ${Buffer.concat(chunks).toString("utf8")}`));
      }, 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
    });
    expect(output).toMatch(/public hop/);
  });

  it("refuses to start without PIE_RELAY_TOKEN", async () => {
    const child = spawnRelay([relayBin, "--port", "18443", "--public-host", "96.44.165.19"], {
      PATH: process.env.PATH,
    });
    children.push(child);
    const code = await new Promise<number | null>((resolve) => {
      child.once("exit", (exitCode) => resolve(exitCode));
    });
    expect(code).not.toBe(0);
  });

  it("listens without PIE_HOME or a daemon and forwards through attach", async () => {
    const backend = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
    await new Promise<void>((resolve) => {
      backend.listen(0, "127.0.0.1", resolve);
    });
    const backendPort = (backend.address() as AddressInfo).port;
    const port = 20000 + Math.floor(Math.random() * 10000);
    const token = "relay-token-standalone-test";
    const child = spawnRelay([relayBin, "--port", String(port), "--public-host", "96.44.165.19"], {
      PATH: process.env.PATH,
      PIE_RELAY_TOKEN: token,
    });
    children.push(child);
    const started = await waitForListening(child);
    expect(started).toContain(`http://96.44.165.19:${String(port)}`);
    expect(started).not.toMatch(/100\.|ts\.net|192\.168\.31/);
    const controlMatch = started.match(/pie relay control on \S+:(\d+)/);
    expect(controlMatch?.[1]).toEqual(expect.any(String));
    const controlPort = Number(controlMatch?.[1]);

    const attach = await attachRelay({
      relayHost: "127.0.0.1",
      relayPort: controlPort,
      token,
      localHost: "127.0.0.1",
      localPort: backendPort,
    });
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      await expect(response.text()).resolves.toBe("ok");
    } finally {
      await attach.close();
      await new Promise<void>((resolve) => {
        backend.close(() => resolve());
      });
    }
  });

  it("is one file, smaller than the full CLI, and not a shared chunk", () => {
    const source = fs.readFileSync(relayBin, "utf8");
    expect(source).not.toMatch(/from ["']\.\/relay-cli-/);
    const relay = fs.statSync(relayBin).size;
    const cli = fs.statSync(cliBin).size;
    expect(relay).toBeGreaterThan(0);
    expect(relay).toBeLessThan(cli);
  });
});
