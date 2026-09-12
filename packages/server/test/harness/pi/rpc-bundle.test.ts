import assert from "node:assert/strict";
import path from "node:path";
import url from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { layer } from "@effect/vitest";
import { Deferred, Effect, FileSystem, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const bundle = url.fileURLToPath(new URL("../../../dist/pi-rpc/pi-rpc.js", import.meta.url));

layer(NodeServices.layer)("Pi RPC bundle", (it) => {
  for (const provider of ["xai", "amazon-bedrock"]) {
    it.effect(`loads the bundled ${provider} authentication and model implementation`, () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "pie-oauth-bundle-" });
        const runtimeDir = path.join(cwd, "runtime");
        yield* fs.copy(path.dirname(bundle), runtimeDir);
        const turnEnded = yield* Deferred.make<void>();
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
        // Bun embeds Photon's build-machine path; make it unavailable even on the build machine.
        yield* fs.writeFileString(
          path.join(cwd, "isolate-wasm.mjs"),
          `import fs from "node:fs";
          import path from "node:path";
          const readFileSync = fs.readFileSync;
          fs.readFileSync = (file, ...args) => {
            if (String(file).endsWith("photon_rs_bg.wasm") &&
                String(file) !== path.join(process.cwd(), "runtime/photon_rs_bg.wasm")) {
              throw Object.assign(new Error("Build-machine WASM is unavailable"), { code: "ENOENT" });
            }
            return readFileSync(file, ...args);
          };`,
        );
        if (provider === "xai") {
          yield* fs.writeFileString(
            path.join(cwd, "worker-check.mjs"),
            'import "./isolate-wasm.mjs"; await import("./runtime/image-resize-worker.js");',
          );
          yield* fs.makeDirectory(path.join(cwd, "extensions"));
          yield* fs.writeFileString(
            path.join(cwd, "extensions/runtime-check.ts"),
            `import assert from "node:assert/strict";
            import fs from "node:fs";
            import path from "node:path";
            import { once } from "node:events";
            import { Worker } from "node:worker_threads";
            import { Type } from "typebox";
            import { Value } from "typebox/value";
            import { Agent } from "@earendil-works/pi-agent-core";
            import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
            import { getModel } from "@mariozechner/pi-ai";
            import {
              builtInExtensions, getPackageDir, getReadmePath, getDocsPath,
              getExamplesPath, resizeImage, convertToPng, VERSION,
            } from "@earendil-works/pi-coding-agent";

            export default async function (pi) {
              assert.equal(typeof Agent, "function");
              assert.ok(Value.Check(Type.String(), "bundled typebox"));
              assert.equal(getModel("xai", "grok-4.6").provider, "xai");
              assert.ok(builtInExtensions.some((extension) => extension.name === "llama.cpp"));
              assert.equal(getPackageDir(), path.join(process.cwd(), "runtime"));
              assert.equal(VERSION, "0.85.1");
              for (const file of [getReadmePath(), path.join(getDocsPath(), "extensions.md"),
                path.join(getExamplesPath(), "sdk/06-extensions.ts"),
                path.join(getPackageDir(), "CHANGELOG.md")]) {
                assert.ok(fs.readFileSync(file, "utf8").length > 0, file);
              }
              const oauthProviders = builtinProviders().filter((provider) => provider.auth?.oauth);
              assert.deepEqual(oauthProviders.map((provider) => provider.id).sort(), [
                "anthropic", "github-copilot", "kimi-coding", "openai-codex",
                "openrouter", "radius", "xai",
              ]);
              for (const provider of oauthProviders) {
                const auth = await provider.auth.oauth.toAuth({
                  type: "oauth", access: "test-access", refresh: "test-refresh", expires: 0,
                });
                assert.ok(auth.apiKey || auth.headers, provider.id);
              }
              const png = Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAHUlEQVR4AQESAO3/AP8AAP8A/wD/AAAA////////ScgJ962rVhsAAAAASUVORK5CYII=",
                "base64",
              );
              const options = { maxWidth: 1, maxHeight: 1 };
              // Test the worker directly so a silent in-process fallback cannot hide missing assets.
              const worker = new Worker(path.join(process.cwd(), "worker-check.mjs"));
              try {
                const message = once(worker, "message");
                worker.postMessage({ inputBytes: png, mimeType: "image/png", options });
                const [response] = await message;
                assert.equal(response.error, undefined);
                assert.equal(response.result?.width, 1);
                assert.equal(response.result?.wasResized, true);
              } finally {
                await worker.terminate();
              }
              const resized = await resizeImage(png, "image/png", options);
              assert.equal(resized?.width, 1);
              assert.equal(resized?.height, 1);
              assert.equal(resized?.originalWidth, 2);
              assert.equal(resized?.wasResized, true);
              // Conversion loads Photon in the RPC process, independently of the worker.
              const converted = await convertToPng(
                "Qk0+AAAAAAAAADYAAAAoAAAAAgAAAAEAAAABABgAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AP8AAAA=",
                "image/bmp",
              );
              assert.equal(converted?.mimeType, "image/png");
              pi.on("session_start", () => console.log("bundled runtime checks passed"));
            }`,
          );
        }
        const child = yield* spawner.spawn(
          ChildProcess.make(
            "bun",
            [
              "--no-install",
              "--preload",
              preload,
              "--preload",
              path.join(cwd, "isolate-wasm.mjs"),
              path.join(runtimeDir, "pi-rpc.js"),
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
              stdin: Stream.make('{"type":"prompt","message":"test"}\n').pipe(
                Stream.concat(
                  Stream.fromEffect(
                    Deferred.await(turnEnded).pipe(
                      Effect.as('{"type":"export_html","outputPath":"conversation.html"}\n'),
                    ),
                  ),
                ),
                Stream.encodeText,
                Stream.concat(Stream.never),
              ),
            },
          ),
        );
        const lines = yield* Stream.merge(child.stdout, child.stderr).pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.tap((line) =>
            line.includes('"type":"agent_end"')
              ? Deferred.succeed(turnEnded, undefined)
              : Effect.void,
          ),
          Stream.takeUntil((line) => line.includes('"command":"export_html"')),
          Stream.runCollect,
        );
        const output = lines.join("\n");
        assert.doesNotMatch(output, /Cannot find module|OAuth refresh failed|extension_error/);
        assert.match(output, /test model response/);
        assert.match(output, /"command":"export_html","success":true/);
        const html = yield* fs.readFileString(path.join(cwd, "conversation.html"));
        assert.match(html, /<!DOCTYPE html>/i);
        assert.match(
          html,
          /<script id="session-data" type="application\/json">[A-Za-z0-9+/=]+<\/script>/,
        );
        assert.ok(!/^(?:\{\{CSS\}\}|\{\{JS\}\})$|<script>\{\{/m.test(html));
        if (provider === "xai") {
          assert.match(output, /bundled runtime checks passed/);
          const auth = yield* fs.readFileString(authPath);
          assert.match(auth, /refreshed-test-access/);
          assert.match(auth, /rotated-test-refresh/);
        }
      }),
    );
  }
});
