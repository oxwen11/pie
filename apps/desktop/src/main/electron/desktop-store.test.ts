import assert from "node:assert/strict";
import path from "node:path";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { layer } from "@effect/vitest";
import * as Observability from "@getpie/server/observability";
import { Effect, FileSystem, Layer } from "effect";
import { describe, expect, it as test } from "vitest";

import {
  DEFAULT_DESKTOP_SETTINGS,
  assignUiWindow,
  decodeDesktopSettings,
  isRectVisibleOnWorkArea,
  makeDesktopStore,
  parseDesktopToml,
  placementFromWindowState,
  stringifyDesktopToml,
  windowStateFromBounds,
} from "./desktop-store";

describe("decodeDesktopSettings", () => {
  test("fills defaults for an empty document", () => {
    expect(decodeDesktopSettings(parseDesktopToml(""))).toEqual(DEFAULT_DESKTOP_SETTINGS);
  });

  test("keeps a complete ui.window table", () => {
    expect(
      decodeDesktopSettings(
        parseDesktopToml(
          "[ui.window]\nwidth = 1400\nheight = 900\nx = 12\ny = 40\nmaximized = true\n",
        ),
      ),
    ).toEqual({
      window: { width: 1400, height: 900, x: 12, y: 40, maximized: true },
    });
  });

  test("uses the default size when the stored size is below the minimum", () => {
    expect(
      decodeDesktopSettings(parseDesktopToml("[ui.window]\nwidth = 100\nheight = 100\n")),
    ).toEqual(DEFAULT_DESKTOP_SETTINGS);
  });

  test("rejects a present-but-wrong maximized value", () => {
    expect(() =>
      decodeDesktopSettings(parseDesktopToml('[ui.window]\nmaximized = "yes"\n')),
    ).toThrow(/boolean|maximized/i);
  });
});

describe("stringifyDesktopToml", () => {
  test("omits unset coordinates", () => {
    const text = stringifyDesktopToml(DEFAULT_DESKTOP_SETTINGS);
    expect(text).toMatch(/\[ui\.window\]/);
    expect(text).toMatch(/width = 1200/);
    expect(text).not.toMatch(/\bx = /);
    expect(text).not.toMatch(/\by = /);
  });
});

describe("assignUiWindow", () => {
  test("preserves ui.theme", () => {
    expect(assignUiWindow({ ui: { theme: "dark" } }, DEFAULT_DESKTOP_SETTINGS.window)).toEqual({
      ui: {
        theme: "dark",
        window: { width: 1200, height: 800, maximized: false },
      },
    });
  });
});

describe("placementFromWindowState", () => {
  test("drops coordinates that sit off the work area", () => {
    expect(
      placementFromWindowState(
        { width: 1200, height: 800, x: 8000, y: 8000, maximized: false },
        { x: 0, y: 0, width: 1440, height: 900 },
      ),
    ).toEqual({ width: 1200, height: 800 });
  });

  test("keeps coordinates that overlap the work area", () => {
    expect(
      placementFromWindowState(
        { width: 1200, height: 800, x: 80, y: 40, maximized: false },
        { x: 0, y: 0, width: 1440, height: 900 },
      ),
    ).toEqual({ width: 1200, height: 800, x: 80, y: 40 });
  });
});

describe("isRectVisibleOnWorkArea", () => {
  test("rejects a sliver of overlap", () => {
    expect(
      isRectVisibleOnWorkArea(
        { x: 1400, y: 0, width: 1200, height: 800 },
        { x: 0, y: 0, width: 1440, height: 900 },
      ),
    ).toBe(false);
  });
});

describe("windowStateFromBounds", () => {
  test("rounds and floors to the minimum size", () => {
    expect(windowStateFromBounds({ x: 1.6, y: 2.2, width: 10, height: 10 }, true)).toEqual({
      width: 800,
      height: 600,
      x: 2,
      y: 2,
      maximized: true,
    });
  });
});

const platform = Layer.mergeAll(NodeFileSystem.layer, Observability.discard);

layer(platform)("makeDesktopStore", (it) => {
  it.effect("returns defaults without creating config.toml", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "pie-desktop-store-" });
      const store = yield* makeDesktopStore(path.join(home, "config.toml"));
      const loaded = yield* store.get;
      assert.deepEqual(loaded, DEFAULT_DESKTOP_SETTINGS);
      assert.equal(yield* fs.exists(path.join(home, "config.toml")), false);
    }),
  );

  it.effect("writes ui.window on the first window save and reads it back", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "pie-desktop-store-" });
      const file = path.join(home, "config.toml");
      const store = yield* makeDesktopStore(file);
      const window = { width: 1400, height: 900, x: 24, y: 48, maximized: false };
      yield* store.setWindow(window);
      const text = yield* fs.readFileString(file);
      assert.match(text, /\[ui\.window\]/);
      assert.match(text, /width = 1400/);
      assert.match(text, /x = 24/);
      assert.deepEqual((yield* store.get).window, window);
    }),
  );

  it.effect("leaves ui.theme in place when saving the window", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "pie-desktop-store-" });
      const file = path.join(home, "config.toml");
      yield* fs.writeFileString(file, '[ui]\ntheme = "dark"\n');
      const store = yield* makeDesktopStore(file);
      yield* store.setWindow({ width: 1400, height: 900, maximized: false });
      const text = yield* fs.readFileString(file);
      assert.match(text, /theme = "dark"/);
      assert.match(text, /width = 1400/);
    }),
  );

  it.effect("uses defaults when the file is corrupt instead of blocking", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "pie-desktop-store-" });
      const file = path.join(home, "config.toml");
      yield* fs.writeFileString(file, "window = [");
      const store = yield* makeDesktopStore(file);
      assert.deepEqual(yield* store.get, DEFAULT_DESKTOP_SETTINGS);
      assert.equal(yield* fs.readFileString(file), "window = [");
    }),
  );
});
