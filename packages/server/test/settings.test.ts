import assert from "node:assert/strict";
import path from "node:path";

import { layer } from "@effect/vitest";
import { Context, Effect, FileSystem, Layer } from "effect";

import { layerPaths } from "../src/config/paths";
import { SettingsRepositoryLayer, SettingsService, SettingsServiceLayer } from "../src/index";
import { NodePlatformLayer } from "./platform";

layer(NodePlatformLayer)("SettingsService", (it) => {
  const tempHome = FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.makeTempDirectoryScoped({ prefix: "pie-settings-" })),
  );

  const serviceIn = (home: string) =>
    Layer.build(
      SettingsServiceLayer.pipe(
        Layer.provide(SettingsRepositoryLayer),
        Layer.provide(layerPaths(home)),
        Layer.provide(NodePlatformLayer),
      ),
    ).pipe(Effect.map((context) => Context.get(context, SettingsService)));

  const settings = Effect.flatMap(tempHome, serviceIn);

  it.effect("returns defaults without creating config.json", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      const svc = yield* serviceIn(home);
      const loaded = yield* svc.get();

      assert.equal(loaded.path, path.join(home, "config.json"));
      assert.deepEqual(loaded.settings, { ui: { theme: "system" } });
      assert.equal(yield* fs.exists(loaded.path), false);
    }),
  );

  it.effect("writes config.json on the first update and reads it back", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const svc = yield* settings;
      const saved = yield* svc.update({ ui: { theme: "dark" } });
      assert.deepEqual(saved.settings.ui.theme, "dark");

      const document = JSON.parse(yield* fs.readFileString(saved.path));
      assert.deepEqual(document, { ui: { theme: "dark" } });

      const loaded = yield* svc.get();
      assert.deepEqual(loaded.settings, saved.settings);
    }),
  );

  it.effect("fills a missing theme from defaults when the file exists", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      const file = path.join(home, "config.json");
      yield* fs.writeFileString(file, '{"ui":{}}\n');
      const svc = yield* serviceIn(home);
      assert.deepEqual((yield* svc.get()).settings, { ui: { theme: "system" } });
    }),
  );

  it.effect("reads a leftover appearance object as ui.theme", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      const file = path.join(home, "config.json");
      yield* fs.writeFileString(file, '{"appearance":{"theme":"light"}}\n');
      const svc = yield* serviceIn(home);
      assert.equal((yield* svc.get()).settings.ui.theme, "light");
      yield* svc.update({ ui: { theme: "dark" } });
      const document = JSON.parse(yield* fs.readFileString(file));
      assert.deepEqual(document, { ui: { theme: "dark" } });
    }),
  );

  it.effect("fails with SettingsParseError for invalid JSON", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      yield* fs.writeFileString(path.join(home, "config.json"), "{");
      const svc = yield* serviceIn(home);
      const error = yield* Effect.flip(svc.get());
      assert.equal(error._tag, "SettingsParseError");
    }),
  );

  it.effect("fails with SettingsDecodeError for an unknown theme", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      yield* fs.writeFileString(path.join(home, "config.json"), '{"ui":{"theme":"sepia"}}\n');
      const svc = yield* serviceIn(home);
      const error = yield* Effect.flip(svc.get());
      assert.equal(error._tag, "SettingsDecodeError");
    }),
  );

  it.effect("leaves desktop.window in place when saving theme", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      const file = path.join(home, "config.json");
      yield* fs.writeFileString(
        file,
        JSON.stringify({
          ui: { theme: "system" },
          desktop: { window: { width: 1400, height: 900, maximized: false } },
        }),
      );
      const svc = yield* serviceIn(home);
      yield* svc.update({ ui: { theme: "dark" } });
      assert.deepEqual(JSON.parse(yield* fs.readFileString(file)), {
        ui: { theme: "dark" },
        desktop: { window: { width: 1400, height: 900, maximized: false } },
      });
    }),
  );

  it.effect("relocates leftover ui.window to desktop.window when saving theme", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      const file = path.join(home, "config.json");
      yield* fs.writeFileString(
        file,
        JSON.stringify({
          ui: { theme: "system", window: { width: 1400, height: 900, maximized: false } },
        }),
      );
      const svc = yield* serviceIn(home);
      yield* svc.update({ ui: { theme: "dark" } });
      assert.deepEqual(JSON.parse(yield* fs.readFileString(file)), {
        ui: { theme: "dark" },
        desktop: { window: { width: 1400, height: 900, maximized: false } },
      });
    }),
  );

  it.effect("leaves agent in place when saving theme", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      const file = path.join(home, "config.json");
      yield* fs.writeFileString(
        file,
        JSON.stringify({ ui: { theme: "system" }, agent: { foo: 1 } }),
      );
      const svc = yield* serviceIn(home);
      yield* svc.update({ ui: { theme: "dark" } });
      assert.deepEqual(JSON.parse(yield* fs.readFileString(file)), {
        ui: { theme: "dark" },
        agent: { foo: 1 },
      });
    }),
  );

  it.effect("recovers after a corrupt file is fixed", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      const file = path.join(home, "config.json");
      yield* fs.writeFileString(file, "{");
      const svc = yield* serviceIn(home);
      assert.equal((yield* Effect.flip(svc.get()))._tag, "SettingsParseError");

      yield* fs.writeFileString(file, '{"ui":{"theme":"light"}}\n');
      assert.equal((yield* svc.get()).settings.ui.theme, "light");
    }),
  );
});
