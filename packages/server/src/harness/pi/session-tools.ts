import http from "node:http";
import path from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import type { PullRequestRef, SessionPullRequestLink } from "@getpie/contract/pull-request";
import {
  ByteSize,
  Context,
  Crypto,
  Deferred,
  Effect,
  FileSystem,
  Schema,
  type Scope,
} from "effect";
import { HttpIncomingMessage, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { PiTransportError } from "../errors";
import { sessionToolsExtension } from "./session-tools-extension";

/** Callbacks capture the validated SessionRef and await the Session service's durable writes. */
export type PiSessionToolsShape = {
  readonly list: Effect.Effect<ReadonlyArray<SessionPullRequestLink>, unknown>;
  readonly register: (
    ref: PullRequestRef,
    restore: boolean,
  ) => Effect.Effect<"linked" | "exists" | "excluded", unknown>;
  readonly exclude: (ref: PullRequestRef) => Effect.Effect<void, unknown>;
};

/** Supplied at runtime acquisition, never a dependency of PiAgent's construction layer. */
export class PiSessionTools extends Context.Service<PiSessionTools, PiSessionToolsShape>()(
  "PiSessionTools",
) {}

const RegisterSchema = Schema.Struct({
  url: Schema.String,
  restore: Schema.optionalKey(Schema.Boolean),
});
const ExcludeSchema = Schema.Struct({ url: Schema.String });
const ListSchema = Schema.Struct({});

/** Offline only. The product currently permits github.com, not arbitrary GH_HOST values. */
export function parseSessionPullRequestUrl(value: string): PullRequestRef {
  const match =
    /^https:\/\/github\.com\/([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38}))\/([a-zA-Z0-9_.-]{1,100})\/pull\/([1-9][0-9]*)\/?$/.exec(
      value,
    );
  const owner = match?.[1];
  const repository = match?.[2];
  const rawNumber = match?.[3];
  if (!owner || !repository || !rawNumber || repository === "." || repository === "..")
    throw new Error("Invalid GitHub PR URL");
  const number = Number(rawNumber);
  if (!Number.isSafeInteger(number)) throw new Error("Invalid GitHub PR number");
  return {
    host: "github.com",
    owner: owner.toLowerCase(),
    repository: repository.toLowerCase(),
    number,
  };
}

function authorized(expected: string, actual: string | undefined): boolean {
  if (actual === undefined || actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return diff === 0;
}

export const makePiSessionToolsBridge = (
  tools: PiSessionToolsShape,
): Effect.Effect<
  {
    readonly ready: Effect.Effect<void, PiTransportError>;
    readonly args: ReadonlyArray<string>;
    readonly env: Record<string, string>;
  },
  PiTransportError,
  Scope.Scope | FileSystem.FileSystem | Crypto.Crypto
> =>
  Effect.gen(function* () {
    const ready = yield* Deferred.make<void>();
    const fs = yield* FileSystem.FileSystem;
    const crypto = yield* Crypto.Crypto;
    const token = Buffer.from(yield* crypto.randomBytes(32)).toString("hex");
    const server = yield* NodeHttpServer.make(() => http.createServer(), {
      host: "127.0.0.1",
      port: 0,
      gracefulShutdownTimeout: "1 second",
    });
    if (server.address._tag !== "InetAddressV4") return yield* Effect.die("Expected TCP bridge");
    const host = `127.0.0.1:${server.address.port}`;
    const app = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      // No browser origins, query-string credentials, alternate hosts, or other methods.
      if (
        request.method !== "POST" ||
        request.headers.host !== host ||
        request.headers.origin !== undefined ||
        !authorized(`Bearer ${token}`, request.headers.authorization)
      ) {
        return HttpServerResponse.empty({ status: 403 });
      }
      const json = (body: unknown) =>
        HttpServerResponse.jsonUnsafe(body, { headers: { "cache-control": "no-store" } });
      const decodeOptions = { onExcessProperty: "error" } as const;
      if (request.url === "/ready") {
        yield* HttpServerRequest.schemaBodyJson(ListSchema, decodeOptions);
        yield* Deferred.succeed(ready, undefined);
        return json({ ready: true });
      }
      if (request.url === "/list") {
        yield* HttpServerRequest.schemaBodyJson(ListSchema, decodeOptions);
        const links = yield* tools.list;
        return json({
          links: links.slice(0, 100).map(({ ref, excluded }) => ({ ref, excluded })),
          omitted: Math.max(0, links.length - 100),
        });
      }
      if (request.url === "/register") {
        const input = yield* HttpServerRequest.schemaBodyJson(RegisterSchema, decodeOptions);
        const ref = yield* Effect.try(() => parseSessionPullRequestUrl(input.url));
        const status = yield* tools.register(ref, input.restore === true);
        return json({ ref, status });
      }
      if (request.url === "/exclude") {
        const input = yield* HttpServerRequest.schemaBodyJson(ExcludeSchema, decodeOptions);
        const ref = yield* Effect.try(() => parseSessionPullRequestUrl(input.url));
        yield* tools.exclude(ref);
        return json({ ref, status: "excluded" });
      }
      return HttpServerResponse.empty({ status: 404 });
    }).pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(4096)),
      // Never expose repository errors, paths, or credentials to the child.
      Effect.catchCause(() => Effect.succeed(HttpServerResponse.empty({ status: 400 }))),
    );
    yield* server.serve(app);
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "pie-session-tools-" });
    yield* fs.chmod(directory, 0o700);
    const extension = path.join(directory, "session-tools.mjs");
    yield* fs.writeFileString(extension, sessionToolsExtension, { mode: 0o600 });
    return {
      ready: Deferred.await(ready).pipe(
        Effect.timeoutOrElse({
          duration: "30 seconds",
          orElse: () =>
            Effect.fail(
              new PiTransportError({
                operation: "session-tools-loading",
                cause: new Error("Pi did not load session tools"),
              }),
            ),
        }),
      ),
      args: ["--extension", extension],
      env: { PIE_SESSION_BRIDGE_URL: `http://${host}`, PIE_SESSION_BRIDGE_TOKEN: token },
    };
  }).pipe(
    Effect.mapError(
      () =>
        new PiTransportError({
          operation: "session-tools-bridge",
          cause: new Error("Unable to start session tools"),
        }),
    ),
  );
