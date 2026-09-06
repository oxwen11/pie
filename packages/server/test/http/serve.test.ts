import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { layer as testLayer } from "@effect/vitest";
import { Cause, ConfigProvider, Effect, Exit, Fiber, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveServeConfig, runServe } from "../../src/http/serve";
import { ServerStartupError } from "../../src/http/server";
import { NodePlatformLayer } from "../platform";

const ENV_KEYS = [
  // `runServe` provides observability, which writes below `$PIE_HOME/logs`.
  // Pin it per test so the suite never touches the developer's real home.
  // `PIE_AUTH_TOKEN` likewise: the scrub test owns it, no other test reads it.
  "PIE_HOME",
  "PIE_AUTH_TOKEN",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const withConfig = (values: Record<string, unknown>) =>
  ConfigProvider.layer(ConfigProvider.fromUnknown(values));

testLayer(NodePlatformLayer)("resolveServeConfig", (effectIt) => {
  effectIt.effect("prefers the flag over config and default for the port", () =>
    Effect.gen(function* () {
      const config = yield* resolveServeConfig({
        port: Option.some(3000),
        corsOrigin: [],
        allowedHost: [],
      }).pipe(Effect.provide(withConfig({ PIE_PORT: "5000" })));
      assert.equal(config.port, 3000);
    }),
  );

  effectIt.effect("falls back to PIE_PORT when no flag is given", () =>
    Effect.gen(function* () {
      const config = yield* resolveServeConfig({
        port: Option.none(),
        corsOrigin: [],
        allowedHost: [],
      }).pipe(Effect.provide(withConfig({ PIE_PORT: "5000" })));
      assert.equal(config.port, 5000);
    }),
  );

  effectIt.effect("defaults to 4000 in production and 0 in development", () =>
    Effect.gen(function* () {
      const production = yield* resolveServeConfig({
        port: Option.none(),
        corsOrigin: [],
        allowedHost: [],
      }).pipe(Effect.provide(withConfig({})));
      assert.equal(production.port, 4000);
      const development = yield* resolveServeConfig({
        port: Option.none(),
        corsOrigin: [],
        allowedHost: [],
      }).pipe(Effect.provide(withConfig({ NODE_ENV: "development" })));
      assert.equal(development.port, 0);
    }),
  );

  effectIt.effect("prefers repeated --cors-origin flags over PIE_CORS_ORIGINS", () =>
    Effect.gen(function* () {
      const config = yield* resolveServeConfig({
        port: Option.none(),
        corsOrigin: ["https://a.test", "https://b.test"],
        allowedHost: [],
      }).pipe(Effect.provide(withConfig({ PIE_CORS_ORIGINS: "https://env.example" })));
      assert.deepEqual(config.corsOrigins, ["https://a.test", "https://b.test"]);
    }),
  );

  effectIt.effect("falls back to the comma-separated env list when no flag is given", () =>
    Effect.gen(function* () {
      const config = yield* resolveServeConfig({
        port: Option.none(),
        corsOrigin: [],
        allowedHost: [],
      }).pipe(
        Effect.provide(withConfig({ PIE_CORS_ORIGINS: " https://a.test , https://b.test ," })),
      );
      assert.deepEqual(config.corsOrigins, ["https://a.test", "https://b.test"]);
    }),
  );
});

describe("runServe", () => {
  it("scrubs PIE_AUTH_TOKEN from the environment and still guards the server", async () => {
    // Occupy then release a port so the server can own it for this test.
    const blocker = net.createServer();
    await new Promise<void>((resolve) => {
      blocker.listen(0, "127.0.0.1", resolve);
    });
    const { port } = blocker.address() as AddressInfo;
    await new Promise<void>((resolve) => {
      blocker.close(() => resolve());
    });

    const home = await fs.mkdtemp(path.join(os.tmpdir(), "pie-serve-"));
    process.env.PIE_HOME = home;
    const token = "scrub-test-token-0000";
    process.env.PIE_AUTH_TOKEN = token;

    const fiber = Effect.runFork(
      Effect.scoped(runServe({ port: Option.some(port), corsOrigin: [], allowedHost: [] })).pipe(
        Effect.provide(NodePlatformLayer),
      ),
    );

    try {
      // A responding health endpoint means startup completed: the Config read
      // (and its scrub) happens before the server is even created.
      const base = `http://127.0.0.1:${port}`;
      let listening = false;
      for (let attempt = 0; attempt < 100 && !listening; attempt++) {
        const response = await fetch(`${base}/api/health`).catch(() => undefined);
        if (response !== undefined && response.status === 200) listening = true;
        else
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 50);
          });
      }
      expect(listening).toBe(true);

      // The Config-read token is the credential the server enforces.
      const rejected = await fetch(`${base}/api/ws-ticket`, {
        method: "POST",
        headers: { authorization: "Bearer wrong-token-0000" },
      });
      expect(rejected.status).toBe(401);
      const accepted = await fetch(`${base}/api/ws-ticket`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(accepted.status).toBe(200);

      // Read once, then scrubbed: pi children and their tool shells inherit
      // this process environment and must not see the credential.
      assert.equal(process.env.PIE_AUTH_TOKEN, undefined);
    } finally {
      await Effect.runPromise(Fiber.interrupt(fiber));
      delete process.env.PIE_AUTH_TOKEN;
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it("fails with a typed startup error when binding the port fails", async () => {
    // Occupy a port so runServe's listen stage fails after the server (and its
    // runtime) has been built; the scope then releases what was acquired.
    const blocker = net.createServer();
    await new Promise<void>((resolve) => {
      blocker.listen(0, "127.0.0.1", resolve);
    });
    const { port } = blocker.address() as AddressInfo;

    const home = await fs.mkdtemp(path.join(os.tmpdir(), "pie-serve-"));
    process.env.PIE_HOME = home;

    try {
      const exit = await Effect.runPromiseExit(
        Effect.scoped(runServe({ port: Option.some(port), corsOrigin: [], allowedHost: [] })).pipe(
          Effect.provide(NodePlatformLayer),
        ),
      );
      const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
      expect(error).toBeInstanceOf(ServerStartupError);
      expect((error as ServerStartupError).phase).toBe("listen");

      const content = await fs.readFile(path.join(home, "logs", "pie.log"), "utf8");
      const startupFailure = content
        .trim()
        .split("\n")
        .find((line) => line.includes("event=server.startup_failed"));
      expect(startupFailure).toContain("phase=listen");
      expect(startupFailure).toContain("cause=");
      expect(startupFailure).toContain("ServerStartupError");
    } finally {
      await new Promise<void>((resolve) => {
        blocker.close(() => resolve());
      });
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});
