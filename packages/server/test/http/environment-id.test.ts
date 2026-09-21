import assert from "node:assert/strict";
import path from "node:path";

import { layer } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

import { StoreWriteError } from "../../src/errors";
import { environmentIdFile, loadOrCreateEnvironmentId } from "../../src/http/environment-id";
import { fakeFileSystem, notFound, permissionDenied } from "../fake-file-system";
import { NodePlatformLayer } from "../platform";

layer(NodePlatformLayer)("environment id", (it) => {
  it.effect("persists a uuid under storage and reuses it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "pie-env-id-" });
      const first = yield* loadOrCreateEnvironmentId(home);
      const second = yield* loadOrCreateEnvironmentId(home);
      assert.equal(first, second);
      assert.match(first, /^[0-9a-f-]{36}$/i);
      const stored = (yield* fs.readFileString(environmentIdFile(home))).trim();
      assert.equal(stored, first);
    }),
  );

  it.effect.skipIf(process.platform === "win32")("creates the id file with 0600 perms", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "pie-env-id-" });
      yield* loadOrCreateEnvironmentId(home);
      const info = yield* fs.stat(environmentIdFile(home));
      assert.equal((info.mode ?? 0) & 0o777, 0o600);
    }),
  );

  it.effect("fails closed when chmod 0600 cannot be applied", () =>
    Effect.gen(function* () {
      const home = path.join("/tmp", "pie-env-id-chmod-fail");
      const file = environmentIdFile(home);
      const result = yield* loadOrCreateEnvironmentId(home).pipe(
        Effect.provide(
          fakeFileSystem({
            readFileString: () => Effect.fail(notFound("readFileString", file)),
            makeDirectory: () => Effect.void,
            writeFileString: () => Effect.void,
            chmod: () => Effect.fail(permissionDenied("chmod", file)),
          }),
        ),
        Effect.flip,
      );
      assert.equal(result._tag, "StoreWriteError");
      assert.ok(result instanceof StoreWriteError);
    }),
  );
});
