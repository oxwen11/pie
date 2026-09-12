import assert from "node:assert/strict";
import path from "node:path";
import url from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import { Effect, FileSystem, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const bundle = url.fileURLToPath(new URL("../../../dist/pi-rpc/pi-rpc.js", import.meta.url));

layer(NodeServices.layer)("Pi RPC bundle", (it) => {
  for (const provider of ["xai", "amazon-bedrock"]) {
    it.effect(`loads the bundled ${provider} authentication and model implementation`, () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "pie-oauth-bundle-" });
        const authPath = path.join(cwd, "auth.json");
        const preload = path.join(cwd, "fetch.mjs");
        yield* fs.writeFileString(
          authPath,
          JSON.stringify({
            xai: {
              type: "oauth",
              access: "expired-test-access",
              refresh: "test-refresh",
              expires: 0,
            },
          }),
        );
        yield* fs.writeFileString(
          path.join(cwd, "settings.json"),
          JSON.stringify({ retry: { enabled: false } }),
        );
        // Exercise the real bundled refresh path, but never use the network or user credentials.
        yield* fs.writeFileString(
          preload,
          `import assert from "node:assert/strict";
        import http from "node:http";
        import fs from "node:fs";
        const server = http.createServer((request, response) => {
          request.resume();
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ message: "test model response" }));
        });
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        server.unref();
        fs.writeFileSync("models.json", JSON.stringify({
          providers: { "amazon-bedrock": { baseUrl: "http://127.0.0.1:" + server.address().port } },
        }));
        globalThis.fetch = async (url, options) => {
          if (String(url) === "https://auth.x.ai/oauth2/token") {
            assert.equal(options.body.get("grant_type"), "refresh_token");
            assert.equal(options.body.get("refresh_token"), "test-refresh");
            return Response.json({
              access_token: "refreshed-test-access",
              refresh_token: "rotated-test-refresh",
              expires_in: 3600,
            });
          }
          return Response.json({ error: { message: "test model response" } }, { status: 400 });
        };`,
        );
        const child = yield* spawner.spawn(
          ChildProcess.make(
            "bun",
            [
              "--preload",
              preload,
              bundle,
              "--mode",
              "rpc",
              "--provider",
              provider,
              "--model",
              provider === "xai" ? "grok-4.6" : "anthropic.claude-3-5-sonnet-20241022-v2:0",
            ],
            {
              cwd,
              env: {
                PATH: process.env.PATH,
                HOME: cwd,
                PI_CODING_AGENT_DIR: cwd,
                PI_OFFLINE: "1",
                AWS_ACCESS_KEY_ID: "test-access-key",
                AWS_SECRET_ACCESS_KEY: "test-secret-key",
                AWS_REGION: "us-east-1",
                AWS_BEDROCK_FORCE_HTTP1: "1",
              },
              // Keep stdin open until the turn finishes; EOF shuts the RPC child down.
              stdin: Stream.concat(
                Stream.make(new TextEncoder().encode('{"type":"prompt","message":"test"}\n')),
                Stream.never,
              ),
            },
          ),
        );
        const lines = yield* child.stdout.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.takeUntil((line) => line.includes('"type":"agent_end"')),
          Stream.runCollect,
        );
        const output = lines.join("\n");
        assert.doesNotMatch(output, /Cannot find module|OAuth refresh failed/);
        assert.match(output, /test model response/);
        if (provider === "xai") {
          const auth = yield* fs.readFileString(authPath);
          assert.match(auth, /refreshed-test-access/);
          assert.match(auth, /rotated-test-refresh/);
        }
      }),
    );
  }
});
