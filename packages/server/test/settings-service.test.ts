import assert from "node:assert/strict";
import path from "node:path";

import { layer } from "@effect/vitest";
import { Context, Effect, FileSystem, Layer } from "effect";

import { layerPaths, SettingsService, SettingsServiceLayer } from "../src/index";
import { NodePlatformLayer } from "./platform";

layer(NodePlatformLayer)("SettingsService", (it) => {
  const tempHome = FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.makeTempDirectoryScoped({ prefix: "pie-settings-" })),
  );

  const serviceIn = (home: string) =>
    Layer.build(
      SettingsServiceLayer.pipe(Layer.provide(layerPaths(home)), Layer.provide(NodePlatformLayer)),
    ).pipe(Effect.map((context) => Context.get(context, SettingsService)));

  const settings = Effect.flatMap(tempHome, serviceIn);

  it.effect("returns defaults without creating a file when config.toml is missing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      const svc = yield* serviceIn(home);

      const view = yield* svc.get();
      assert.equal(view.exists, false);
      assert.equal(view.path, path.join(home, "config.toml"));
      assert.equal(view.settings.appearance.theme, "system");
      assert.equal(yield* fs.exists(view.path), false);
    }),
  );

  it.effect("reads a hand-written config.toml", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      const file = path.join(home, "config.toml");
      yield* fs.writeFileString(file, `version = 1\n\n[appearance]\ntheme = "dark"\n`);

      const svc = yield* serviceIn(home);
      const view = yield* svc.get();
      assert.equal(view.exists, true);
      assert.equal(view.settings.appearance.theme, "dark");
    }),
  );

  it.effect("update writes config.toml and get reads it back", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const svc = yield* settings;
      const written = yield* svc.update({
        version: 1,
        appearance: { theme: "light" },
      });
      assert.equal(written.exists, true);
      assert.equal(written.settings.appearance.theme, "light");
      assert.equal(yield* fs.exists(written.path), true);

      const read = yield* svc.get();
      assert.deepEqual(read.settings, written.settings);
    }),
  );

  it.effect.skipIf(process.platform === "win32")("writes config.toml with 0600 perms", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const svc = yield* settings;
      const written = yield* svc.update({
        version: 1,
        appearance: { theme: "dark" },
      });
      const info = yield* fs.stat(written.path);
      assert.equal((info.mode ?? 0) & 0o777, 0o600);
    }),
  );

  it.effect(
    "a corrupt config.toml fails per call with SettingsCorrupt and recovers once fixed",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* tempHome;
        const file = path.join(home, "config.toml");
        yield* fs.writeFileString(file, "theme = [");

        const svc = yield* serviceIn(home);
        const error = yield* Effect.flip(svc.get());
        assert.equal(error._tag, "SettingsCorrupt");

        yield* fs.writeFileString(file, '[appearance]\ntheme = "dark"\n');
        const view = yield* svc.get();
        assert.equal(view.settings.appearance.theme, "dark");
      }),
  );
});
