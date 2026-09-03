import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { layer as testLayer } from "@effect/vitest";
import { Cause, ConfigProvider, Effect, Exit, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveServeConfig, runServe } from "../../src/http/serve";
import { ServerStartupError } from "../../src/http/server";
import { NodePlatformLayer } from "../platform";

const ENV_KEYS = [
  // `runServe` provides observability, which writes below `$PIE_HOME/logs`.
  // Pin it per test so the suite never touches the developer's real home.
  "PIE_HOME",
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
