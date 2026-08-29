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

  it.effect("returns defaults without creating config.toml", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      const svc = yield* serviceIn(home);
      const loaded = yield* svc.get();

      assert.equal(loaded.path, path.join(home, "config.toml"));
      assert.deepEqual(loaded.settings, { ui: { theme: "system" } });
      assert.equal(yield* fs.exists(loaded.path), false);
    }),
  );

  it.effect("writes config.toml on the first update and reads it back", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const svc = yield* settings;
      const saved = yield* svc.update({ ui: { theme: "dark" } });
      assert.deepEqual(saved.settings.ui.theme, "dark");

      const text = yield* fs.readFileString(saved.path);
      assert.match(text, /\[ui\]/);
      assert.match(text, /theme = "dark"/);
      assert.doesNotMatch(text, /\[desktop/);
      assert.doesNotMatch(text, /\[agent/);

      const loaded = yield* svc.get();
      assert.deepEqual(loaded.settings, saved.settings);
    }),
  );

  it.effect("fills a missing theme from defaults when the file exists", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      const file = path.join(home, "config.toml");
      yield* fs.writeFileString(file, "[ui]\n");
      const svc = yield* serviceIn(home);
      assert.deepEqual((yield* svc.get()).settings, { ui: { theme: "system" } });
    }),
  );

  it.effect("reads a pre-[ui] appearance table as ui.theme", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      const file = path.join(home, "config.toml");
      yield* fs.writeFileString(file, '[appearance]\ntheme = "light"\n');
      const svc = yield* serviceIn(home);
      assert.equal((yield* svc.get()).settings.ui.theme, "light");
      yield* svc.update({ ui: { theme: "dark" } });
      const text = yield* fs.readFileString(file);
      assert.match(text, /\[ui\]/);
      assert.doesNotMatch(text, /\[appearance\]/);
    }),
  );

  it.effect("fails with SettingsParseError for invalid TOML", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      yield* fs.writeFileString(path.join(home, "config.toml"), "theme = [");
      const svc = yield* serviceIn(home);
      const error = yield* Effect.flip(svc.get());
      assert.equal(error._tag, "SettingsParseError");
    }),
  );

  it.effect("fails with SettingsDecodeError for an unknown theme", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      yield* fs.writeFileString(path.join(home, "config.toml"), '[ui]\ntheme = "sepia"\n');
      const svc = yield* serviceIn(home);
      const error = yield* Effect.flip(svc.get());
      assert.equal(error._tag, "SettingsDecodeError");
    }),
  );

  it.effect("leaves desktop.window in place when saving theme", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      const file = path.join(home, "config.toml");
      yield* fs.writeFileString(
        file,
        '[ui]\ntheme = "system"\n\n[desktop.window]\nwidth = 1400\nheight = 900\nmaximized = false\n',
      );
      const svc = yield* serviceIn(home);
      yield* svc.update({ ui: { theme: "dark" } });
      const text = yield* fs.readFileString(file);
      assert.match(text, /theme = "dark"/);
      assert.match(text, /\[desktop\.window\]/);
      assert.match(text, /width = 1400/);
      assert.match(text, /height = 900/);
      assert.doesNotMatch(text, /\[ui\.window\]/);
    }),
  );

  it.effect("relocates leftover ui.window to desktop.window when saving theme", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      const file = path.join(home, "config.toml");
      yield* fs.writeFileString(
        file,
        '[ui]\ntheme = "system"\n\n[ui.window]\nwidth = 1400\nheight = 900\nmaximized = false\n',
      );
      const svc = yield* serviceIn(home);
      yield* svc.update({ ui: { theme: "dark" } });
      const text = yield* fs.readFileString(file);
      assert.match(text, /theme = "dark"/);
      assert.match(text, /\[desktop\.window\]/);
      assert.match(text, /width = 1400/);
      assert.doesNotMatch(text, /\[ui\.window\]/);
    }),
  );

  it.effect("leaves [agent] in place when saving theme", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      const file = path.join(home, "config.toml");
      yield* fs.writeFileString(file, '[ui]\ntheme = "system"\n\n[agent]\nfoo = 1\n');
      const svc = yield* serviceIn(home);
      yield* svc.update({ ui: { theme: "dark" } });
      const text = yield* fs.readFileString(file);
      assert.match(text, /theme = "dark"/);
      assert.match(text, /\[agent\]/);
      assert.match(text, /foo = 1/);
    }),
  );

  it.effect("recovers after a corrupt file is fixed", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* tempHome;
      const file = path.join(home, "config.toml");
      yield* fs.writeFileString(file, "theme = [");
      const svc = yield* serviceIn(home);
      assert.equal((yield* Effect.flip(svc.get()))._tag, "SettingsParseError");

      yield* fs.writeFileString(file, '[ui]\ntheme = "light"\n');
      assert.equal((yield* svc.get()).settings.ui.theme, "light");
    }),
  );
});
